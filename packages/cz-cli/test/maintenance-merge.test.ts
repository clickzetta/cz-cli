import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { mergePullRequest, readMergeReceipts } from "../../../scripts/maintenance/merge"
import type { MergeInput, MergeRunner } from "../../../scripts/maintenance/merge"

const directories: string[] = []
const head = "a".repeat(40)
const commit = "b".repeat(40)

afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

function input(): MergeInput {
  const directory = mkdtempSync(path.join(tmpdir(), "cz-maintenance-merge-"))
  directories.push(directory)
  return {
    directory,
    config: { repository: "owner/repo", permissions: { merge: true } },
    task: {
      id: "task-aabbcc001122",
      item: { source: "github-pr", id: "42" },
      status: "completed",
      phase: "review",
      headSha: head,
      reviewedSha: head,
    },
    pullRequestNumber: 42,
    merge: true,
  }
}

function pull() {
  return {
    url: "https://github.com/owner/repo/pull/42",
    number: 42,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    headRefOid: head,
    mergeCommit: null,
    mergedAt: null,
    statusCheckRollup: [
      { __typename: "CheckRun", name: "test", workflowName: "cz-test", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
  }
}

function transport(
  draft: MergeInput,
  options: {
    mode?: "timeout" | "lost-success" | "missing-commit"
    remote?: Record<string, unknown>
    wait?: Promise<void>
    started?: () => void
  } = {},
) {
  const calls: string[][] = []
  const state = { merged: false }
  const run: MergeRunner = async (argv) => {
    calls.push(argv)
    if (argv[2] === "merge") {
      const receipts = await readMergeReceipts(draft.directory)
      expect(receipts).toHaveLength(1)
      expect(receipts[0].status).toBe("merging")
      expect(argv).toContain("--admin")
      expect(argv).toContain("--squash")
      expect(argv[argv.indexOf("--match-head-commit") + 1]).toBe(head)
      options.started?.()
      await options.wait
      if (options.mode === "timeout") throw new Error("merge response timed out")
      state.merged = true
      if (options.mode === "lost-success") throw new Error("server merged but the response was lost")
      return { exitCode: 0, stdout: "Merged", stderr: "" }
    }
    expect(argv[2]).toBe("view")
    expect(argv[argv.indexOf("--repo") + 1]).toBe("owner/repo")
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        ...pull(),
        ...options.remote,
        ...(state.merged
          ? {
              state: "MERGED",
              mergeCommit: options.mode === "missing-commit" ? null : { oid: commit },
              mergedAt: "2026-11-09T00:00:00Z",
            }
          : {}),
      }),
    }
  }
  return { calls, run }
}

describe("review-bound maintenance PR merges", () => {
  test("preview checks readiness without dispatch or allocating a receipt", async () => {
    const draft = input()
    const remote = transport(draft)
    const result = await mergePullRequest({ ...draft, merge: false }, remote.run)
    expect(result.status).toBe("preview")
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
    expect(existsSync(path.join(draft.directory, "outbox"))).toBe(false)
  })

  test("permission is checked before any GitHub access", async () => {
    const draft = input()
    draft.config.permissions.merge = false
    const remote = transport(draft)
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("not authorized")
    expect(remote.calls).toHaveLength(0)
  })

  test("a missing or stale independent review cannot merge", async () => {
    const draft = input()
    draft.task.reviewedSha = "c".repeat(40)
    const remote = transport(draft)
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("reviewedSha")
    expect(remote.calls).toHaveLength(0)
  })

  test("a reviewed SHA without a positive independent-review outcome cannot merge", async () => {
    for (const state of [
      { status: "needs_attention", phase: "review" },
      { status: "completed", phase: "implement" },
    ]) {
      const draft = input()
      Object.assign(draft.task, state)
      const remote = transport(draft)
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("completed its independent review")
      expect(remote.calls).toHaveLength(0)
    }
  })

  test("the task cannot choose a different PR or an unrecorded created PR", async () => {
    const draft = input()
    const remote = transport(draft)
    await expect(mergePullRequest({ ...draft, pullRequestNumber: 43 }, remote.run)).rejects.toThrow("task source")
    draft.task.item.source = "github"
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("pullRequestNumber")
    expect(remote.calls).toHaveLength(0)
    draft.task.pullRequestNumber = 42
    expect((await mergePullRequest({ ...draft, merge: false }, remote.run)).status).toBe("preview")
  })

  test("changed remote head, repository or target branch blocks before dispatch", async () => {
    for (const data of [
      { headRefOid: "d".repeat(40) },
      { url: "https://github.com/other/repo/pull/42" },
      { baseRefName: "dev" },
    ]) {
      const draft = input()
      const remote = transport(draft, { remote: data })
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("does not match")
      expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
      expect(await readMergeReceipts(draft.directory)).toEqual([])
    }
  })

  test("draft or closed PRs do not merge", async () => {
    for (const data of [{ isDraft: true }, { state: "CLOSED" }]) {
      const draft = input()
      const remote = transport(draft, { remote: data })
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("open, non-draft")
      expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
    }
  })

  test("all failed or pending checks block, including an unrelated Claude Review failure", async () => {
    for (const check of [
      {
        __typename: "CheckRun",
        name: "review",
        workflowName: "Claude Code Review",
        status: "COMPLETED",
        conclusion: "FAILURE",
      },
      { __typename: "CheckRun", name: "review", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "StatusContext", state: "FAILURE" },
    ]) {
      const draft = input()
      const remote = transport(draft, { remote: { statusCheckRollup: [...pull().statusCheckRollup, check] } })
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("check is failed, pending")
      expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
    }
  })

  test("an explicit informational policy only exempts Claude Code Review and is recorded", async () => {
    const draft = input()
    draft.config.mergePolicy = { informationalWorkflows: ["Claude Code Review"] }
    const remote = transport(draft, {
      remote: {
        statusCheckRollup: [
          ...pull().statusCheckRollup,
          {
            __typename: "CheckRun",
            name: "review",
            workflowName: "Claude Code Review",
            status: "COMPLETED",
            conclusion: "FAILURE",
          },
        ],
      },
    })
    const preview = await mergePullRequest({ ...draft, merge: false }, remote.run)
    expect(preview.status).toBe("preview")
    expect(preview.informationalWorkflows).toEqual(["Claude Code Review"])
    const result = await mergePullRequest(draft, remote.run)
    expect(result.status).toBe("merged")
    expect(result.informationalWorkflows).toEqual(preview.informationalWorkflows)
    expect((await readMergeReceipts(draft.directory))[0].informationalWorkflows).toEqual(["Claude Code Review"])
  })

  test("an informational Claude review can be pending, but the policy is read anew on each call", async () => {
    const draft = input()
    draft.config.mergePolicy = { informationalWorkflows: ["Claude Code Review"] }
    const remote = transport(draft, {
      remote: {
        statusCheckRollup: [
          ...pull().statusCheckRollup,
          {
            __typename: "CheckRun",
            name: "review",
            workflowName: "Claude Code Review",
            status: "IN_PROGRESS",
            conclusion: "",
          },
        ],
      },
    })
    expect((await mergePullRequest({ ...draft, merge: false }, remote.run)).status).toBe("preview")
    draft.config.mergePolicy.informationalWorkflows = []
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("check is failed, pending")
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
  })

  test("cz-test and unknown workflows cannot be made informational", async () => {
    for (const workflows of [["cz-test"], ["other"], ["Claude Code Review", "cz-test"]]) {
      const draft = input()
      draft.config.mergePolicy = { informationalWorkflows: workflows }
      const remote = transport(draft)
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("Only Claude Code Review")
      expect(remote.calls).toHaveLength(0)
      expect(await readMergeReceipts(draft.directory)).toEqual([])
    }
  })

  test("informational reviews do not waive product failures, pending checks, or unknown check types", async () => {
    for (const check of [
      {
        __typename: "CheckRun",
        name: "security",
        workflowName: "security",
        status: "COMPLETED",
        conclusion: "FAILURE",
      },
      { __typename: "CheckRun", name: "test", workflowName: "cz-test", status: "IN_PROGRESS", conclusion: "" },
      { __typename: "StatusContext", workflowName: "Claude Code Review", state: "FAILURE" },
    ]) {
      const draft = input()
      draft.config.mergePolicy = { informationalWorkflows: ["Claude Code Review"] }
      const remote = transport(draft, { remote: { statusCheckRollup: [...pull().statusCheckRollup, check] } })
      await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("check is failed, pending")
      expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
    }
  })

  test("an informational review cannot replace a successful cz-test result", async () => {
    const draft = input()
    draft.config.mergePolicy = { informationalWorkflows: ["Claude Code Review"] }
    const remote = transport(draft, {
      remote: {
        statusCheckRollup: [
          {
            __typename: "CheckRun",
            name: "review",
            workflowName: "Claude Code Review",
            status: "COMPLETED",
            conclusion: "FAILURE",
          },
        ],
      },
    })
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("successful cz-test/test")
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(0)
  })

  test("a green check with another workflow name cannot satisfy cz-test", async () => {
    const draft = input()
    const remote = transport(draft, {
      remote: { statusCheckRollup: [{ ...pull().statusCheckRollup[0], workflowName: "other" }] },
    })
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("successful cz-test/test")
    expect(await readMergeReceipts(draft.directory)).toEqual([])
  })

  test("records intent, verifies the actual merge commit and deduplicates repeats", async () => {
    const draft = input()
    const remote = transport(draft)
    const result = await mergePullRequest(draft, remote.run)
    expect(result.status).toBe("merged")
    expect("mergeCommitSha" in result && result.mergeCommitSha).toBe(commit)
    const receipts = await readMergeReceipts(draft.directory)
    expect(receipts).toHaveLength(1)
    expect(receipts[0].headSha).toBe(head)
    expect(receipts[0].mergeCommitSha).toBe(commit)
    expect(statSync(receipts[0].file).mode & 0o777).toBe(0o600)
    const calls = remote.calls.length
    expect((await mergePullRequest(draft, remote.run)).status).toBe("merged")
    expect(remote.calls).toHaveLength(calls)
  })

  test("concurrent claims submit one merge", async () => {
    const draft = input()
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const remote = transport(draft, { wait: finish.promise, started: started.resolve })
    const first = mergePullRequest(draft, remote.run)
    await started.promise
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("EEXIST")
    finish.resolve()
    expect((await first).status).toBe("merged")
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(1)
  })

  test("a timeout persists unknown and a retry reconciles without another merge", async () => {
    const draft = input()
    const remote = transport(draft, { mode: "timeout" })
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("outcome is unknown")
    expect((await readMergeReceipts(draft.directory))[0].status).toBe("unknown")
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("not confirmed merged")
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(1)
  })

  test("an unknown successful write is reconciled to the exact remote merge commit", async () => {
    const draft = input()
    const remote = transport(draft, { mode: "lost-success" })
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("outcome is unknown")
    expect((await readMergeReceipts(draft.directory))[0].status).toBe("unknown")
    const result = await mergePullRequest(draft, remote.run)
    expect(result.status).toBe("merged")
    expect("mergeCommitSha" in result && result.mergeCommitSha).toBe(commit)
    expect(remote.calls.filter((argv) => argv[2] === "merge")).toHaveLength(1)
  })

  test("an incomplete post-merge read remains unknown", async () => {
    const draft = input()
    const remote = transport(draft, { mode: "missing-commit" })
    await expect(mergePullRequest(draft, remote.run)).rejects.toThrow("outcome is unknown")
    expect((await readMergeReceipts(draft.directory))[0].status).toBe("unknown")
  })
})

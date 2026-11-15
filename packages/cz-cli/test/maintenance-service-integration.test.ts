import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ServiceStore } from "../../../scripts/maintenance/service-store"

// Real Git repositories, CLI processes and SQLite; only remote protocols are fixtures.
test("supervised rounds serialize, survive restart and retain durable followups", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "maintenance-integration-"))
  const upstream = path.join(directory, "upstream")
  const control = path.join(directory, "control")
  const command = path.resolve(import.meta.dir, "../../../scripts/maintenance.ts")
  const children: ReturnType<typeof Bun.spawn>[] = []
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, CZ_TEST_API_KEY: "0".repeat(64) }
  const run = async (args: string[], cwd = directory) => {
    const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" })
    const [out, error, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect(error + ` exit=${code}`).toContain("exit=0")
    return out
  }
  const start = () => {
    const child = Bun.spawn([process.execPath, command, "service", "run"], {
      cwd: control,
      env,
      stdout: "pipe",
      stderr: "pipe",
    })
    children.push(child)
    return child
  }
  const waitFor = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (predicate()) return
      await Bun.sleep(50)
    }
    throw new Error("Service did not reach the expected state")
  }
  const runtime = path.join(control, ".git/cz-maintenance")
  const state: { store?: ServiceStore } = {}
  try {
    await run(["git", "init", "--initial-branch=main", upstream])
    await run(
      [
        "git",
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "--allow-empty",
        "-m",
        "first",
      ],
      upstream,
    )
    await run(["git", "clone", "--quiet", upstream, control])
    for (const [name, body] of Object.entries({
      gh: "console.log('[]')",
      "systemd-run-fixture":
        "const args=process.argv.slice(2);const child=Bun.spawn(args.slice(args.indexOf('--')+1),{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exit(await child.exited)",
      "systemctl-fixture":
        "console.log(process.argv.includes('--property=MainPID') ? process.ppid : 'LoadState=not-found\\nActiveState=inactive')",
      "lark-cli": "console.log(JSON.stringify({ok:true,identity:'user',data:{items:[],has_more:false}}))",
      "codex-fixture": `import {mkdirSync,rmdirSync} from 'node:fs';
const output=process.argv[process.argv.indexOf('--output-last-message')+1]; await Bun.stdin.text();
mkdirSync(${JSON.stringify(path.join(directory, "model-lock"))});
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture'})); await Bun.sleep(100);
await Bun.write(output,'completed'); console.log(JSON.stringify({type:'turn.completed'}));
rmdirSync(${JSON.stringify(path.join(directory, "model-lock"))});`,
    })) {
      const file = path.join(directory, name)
      await Bun.write(file, `#!${process.execPath}\n${body}\n`)
      chmodSync(file, 0o700)
    }
    await Bun.write(
      path.join(runtime, "config.json"),
      JSON.stringify({
        repository: "example/repo",
        baseRef: "origin/main",
        lark: { identity: "user", chatId: "oc_fixture" },
        permissions: {
          push: false,
          createPullRequest: false,
          postGithub: false,
          postLark: false,
          merge: false,
          release: false,
        },
        native: {
          scheduleMode: "codex-service",
          codex: {
            binary: path.join(directory, "codex-fixture"),
            home: directory,
            sandbox: "read-only",
            timeoutSeconds: 60,
            supervision: {
              run: path.join(directory, "systemd-run-fixture"),
              control: path.join(directory, "systemctl-fixture"),
              unit: "fixture-parent.service",
              environmentFile: path.join(directory, "service.env"),
            },
          },
        },
      }),
    )
    const first = start()
    await waitFor(() => Bun.file(path.join(runtime, "control/service.sqlite")).size > 0)
    state.store = new ServiceStore(path.join(runtime, "control"))
    const store = state.store
    await waitFor(() => store.status().runs.filter((run) => run.status === "completed").length === 2)
    expect(store.status().health).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ source: "github", failures: 0 }),
        expect.objectContaining({ source: "feishu", failures: 0 }),
      ]),
    )
    const duplicate = start()
    expect(await duplicate.exited).toBe(1)
    expect(await new Response(duplicate.stderr).text()).toContain("already owned")
    first.kill("SIGTERM")
    expect(await first.exited).toBe(0)
    expect(store.status().owner).toBeNull()
    await run(
      [process.execPath, command, "service", "followup", "check-ci", "worker", new Date().toISOString(), "Inspect CI"],
      control,
    )
    const second = start()
    await waitFor(() => store.status().runs.filter((run) => run.status === "completed").length === 3)
    expect(store.status().runs.every((run) => run.status === "completed")).toBe(true)
    expect(store.status().timers.length).toBe(2)

    // A broken source must remain unacknowledged without preventing another role from running.
    store.pause("worker", "Source failure acceptance")
    const ledger = path.join(runtime, "intake/github.json")
    const original = await Bun.file(ledger).text()
    const missing = "0".repeat(64)
    await Bun.write(ledger, JSON.stringify({ ...JSON.parse(original), pending: [missing] }))
    store.enqueue("curator", "healthy-role", "Continue independent curation")
    await waitFor(() => store.status().runs.filter((run) => run.status === "completed").length === 4)
    expect(second.exitCode).toBeNull()
    const diagnostic = path.join(runtime, "control/intake-github-error.json")
    expect((await Bun.file(diagnostic).json()).error).toContain("[REDACTED]")
    expect((await Bun.file(diagnostic).json()).error).not.toContain(missing)
    expect(statSync(diagnostic).mode & 0o777).toBe(0o600)
    expect((await Bun.file(ledger).json()).pending).toEqual([missing])
    await Bun.write(ledger, original)
    store.resume("worker", "Restored the source fixture; no external effects occurred")
    await waitFor(() => store.status().runs.filter((run) => run.status === "completed").length === 5)

    // Reloaded configuration must never downgrade a production round to a bare process.
    const config = await Bun.file(path.join(runtime, "config.json")).json()
    const supervision = config.native.codex.supervision
    delete config.native.codex.supervision
    await Bun.write(path.join(runtime, "config.json"), JSON.stringify(config))
    store.enqueue("worker", "changed-configuration", "Reconcile configuration")
    expect(await second.exited).toBe(0)
    expect(store.status().runs.filter((run) => run.status === "completed").length).toBe(5)
    const failed = store.status().runs.find((run) => run.status === "failed")
    expect(failed).toBeDefined()
    expect(Bun.file(path.join(runtime, "control/runs", failed!.id, "events.jsonl")).size).toBe(0)
    const roundDiagnostic = path.join(runtime, "control/runs", failed!.id, "error.json")
    expect((await Bun.file(roundDiagnostic).json()).error).toContain("per-round systemd supervision")
    expect(statSync(roundDiagnostic).mode & 0o777).toBe(0o600)
    expect(store.status().roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "worker", paused: expect.any(String) })]),
    )

    // A startup sync failure also preserves a private cause without launching a model.
    config.native.codex.supervision = supervision
    await Bun.write(path.join(runtime, "config.json"), JSON.stringify(config))
    await run(["git", "remote", "set-url", "origin", path.join(directory, env.CZ_TEST_API_KEY)], control)
    const third = start()
    expect(await third.exited).toBe(1)
    const startupDiagnostic = path.join(runtime, "control/service-error.json")
    expect((await Bun.file(startupDiagnostic).json()).error).toContain("git fetch failed")
    expect((await Bun.file(startupDiagnostic).json()).error).not.toContain(env.CZ_TEST_API_KEY)
    expect(statSync(startupDiagnostic).mode & 0o777).toBe(0o600)
    expect(await new Response(third.stderr).text()).not.toContain(env.CZ_TEST_API_KEY)
  } finally {
    children.forEach((child) => {
      if (child.exitCode === null) child.kill("SIGTERM")
    })
    await Promise.all(children.map((child) => child.exited))
    state.store?.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)

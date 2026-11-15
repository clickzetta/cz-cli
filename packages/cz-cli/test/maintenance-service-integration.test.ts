import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync } from "node:fs"
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
  const env = { ...process.env, PATH: `${directory}:${process.env.PATH}` }
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

    // Reloaded configuration must never downgrade a production round to a bare process.
    const config = await Bun.file(path.join(runtime, "config.json")).json()
    delete config.native.codex.supervision
    await Bun.write(path.join(runtime, "config.json"), JSON.stringify(config))
    store.enqueue("worker", "changed-configuration", "Reconcile configuration")
    expect(await second.exited).toBe(0)
    expect(store.status().runs.filter((run) => run.status === "completed").length).toBe(3)
    const failed = store.status().runs.find((run) => run.status === "failed")
    expect(failed).toBeDefined()
    expect(Bun.file(path.join(runtime, "control/runs", failed!.id, "events.jsonl")).size).toBe(0)
    expect(store.status().roles).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "worker", paused: expect.any(String) })]),
    )
  } finally {
    children.forEach((child) => {
      if (child.exitCode === null) child.kill("SIGTERM")
    })
    await Promise.all(children.map((child) => child.exited))
    state.store?.db.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)

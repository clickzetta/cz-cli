import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { executeReview } from "../review-executor"

test("review completion requires terminal proof and preserves recovery and failure boundaries", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "review-executor-"))
  const execute = async (mode: string, name: string) => {
    const binary = path.join(directory, "codex-fixture")
    await Bun.write(
      binary,
      `#!${process.execPath}\nconst args=process.argv.slice(2); const output=args[args.indexOf('--output-last-message')+1];
await Bun.stdin.text();
${mode}\n`,
    )
    chmodSync(binary, 0o700)
    return executeReview({
      binary,
      home: directory,
      source: directory,
      directory: path.join(directory, name),
      model: "fixture",
      prompt: "Read-only review fixture",
      schema: path.join(directory, "schema.json"),
    })
  }
  try {
    expect(
      await execute(
        "console.log(JSON.stringify({type:'error'})); await Bun.write(output,'finished'); console.log(JSON.stringify({type:'turn.completed'}));",
        "recovered",
      ),
    ).toBe("finished")
    for (const name of ["prompt.txt", "events.jsonl", "stderr.log", "response.txt"])
      expect(statSync(path.join(directory, "recovered", name)).mode & 0o777).toBe(0o600)
    expect(statSync(path.join(directory, "recovered")).mode & 0o777).toBe(0o700)
    for (const [name, mode] of Object.entries({
      failed:
        "await Bun.write(output,'partial'); console.log(JSON.stringify({type:'turn.failed'})); console.log(JSON.stringify({type:'turn.completed'}));",
      malformed:
        "await Bun.write(output,'partial'); console.log('invalid json'); console.log(JSON.stringify({type:'turn.completed'}));",
      nonzero:
        "await Bun.write(output,'partial'); console.log(JSON.stringify({type:'turn.completed'})); process.exitCode=1;",
      trailing:
        "await Bun.write(output,'partial'); console.log(JSON.stringify({type:'turn.completed'})); console.log(JSON.stringify({type:'error'})); console.log(JSON.stringify({type:'turn.completed'}));",
      incomplete: "await Bun.write(output,'partial');",
      empty: "console.log(JSON.stringify({type:'turn.completed'}));",
    }))
      expect(await execute(mode, name)).toBeUndefined()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 15000)

test("a review timeout rejects partial output and terminates its process group", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "review-timeout-"))
  const binary = path.join(directory, "codex-fixture")
  const pid = path.join(directory, "child.pid")
  try {
    await Bun.write(
      binary,
      `#!${process.execPath}\n
const child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'ignore',stderr:'ignore'});
await Bun.write(${JSON.stringify(pid)},String(child.pid));
setInterval(()=>{},1000);\n`,
    )
    chmodSync(binary, 0o700)
    expect(
      await executeReview({
        binary,
        home: directory,
        source: directory,
        directory: path.join(directory, "run"),
        model: "fixture",
        prompt: "Timeout fixture",
        schema: path.join(directory, "schema.json"),
        timeoutMs: 2000,
      }),
    ).toBeUndefined()
    const child = Number(await Bun.file(pid).text())
    const alive = () => {
      try {
        process.kill(child, 0)
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
        return false
      }
    }
    for (let attempt = 0; attempt < 100 && alive(); attempt++) await Bun.sleep(10)
    expect(alive()).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 15000)

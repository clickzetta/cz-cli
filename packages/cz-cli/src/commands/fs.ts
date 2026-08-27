import type { Argv } from "yargs"
import { InterfaceError } from "@clickzetta/sdk"
import { FsError, FsUtil } from "@clickzetta/sdk/fsutil"
import type { GlobalArgs } from "../cli.js"
import { commandGroup } from "../command-group.js"
import { error, success } from "../output/index.js"
import { classifyExecError, getExecContext, execSql } from "./exec.js"
import { resolveConnectionConfig } from "../connection/config.js"

interface FsArgs extends GlobalArgs {
  path: string
  file: string
  volume: string
  source: string
  destination: string
  recursive: boolean
  force: boolean
  "dry-run": boolean
  overwrite: boolean
  bytes: number
  limit: number
}

export function registerFsCommand(cli: Argv<GlobalArgs>): void {
  cli.command("fs", "Manage local files and Lakehouse Volume files", (yargs) =>
    commandGroup(yargs, "fs")
      .command(
        "ls <path>",
        "List files or directories",
        (y) => y
          .positional("path", { type: "string", demandOption: true, describe: "Local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Include files in all subdirectories" })
          .option("limit", { type: "number", default: 100, describe: "Maximum entries to display; 0 means unlimited" })
          .example("cz-cli fs ls volume:user://~/", "List files in your User Volume")
          .example("cz-cli fs ls volume:user://~/images -R", "List a User Volume directory recursively"),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            if (!Number.isInteger(args.limit) || args.limit < 0) throw new FsError("FS_LIMIT_INVALID", "--limit must be a non-negative integer")
            const fs = createFs(args)
            const entries = await fs.ls(args.path, args.recursive, args.limit > 0 ? args.limit + 1 : 0)
            const limited = args.limit === 0 ? entries : entries.slice(0, args.limit)
            success({ entries: limited.map((entry) => ({ path: entry.path, name: entry.name, type: entry.isDir ? "directory" : "file", size_bytes: entry.size, modified_at: formatModifiedAt(entry.modificationTime) })), truncated: args.limit > 0 && entries.length > args.limit }, { format: args.format, rowsKey: "entries" })
          } catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "head <file>",
        "Print the beginning of a UTF-8 text file",
        (y) => y
          .positional("file", { type: "string", demandOption: true, describe: "Local or Volume file path" })
          .option("bytes", { alias: "c", type: "number", default: 65536, describe: "Maximum bytes to read" }),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            if (!Number.isInteger(args.bytes) || args.bytes < 1 || args.bytes > 16_777_216) throw new FsError("FS_LIMIT_INVALID", "--bytes must be an integer between 1 and 16777216")
            const data = await createFs(args).readBytes(args.file, args.bytes + 1)
            const truncated = data.byteLength > args.bytes
            const contentBytes = truncated ? data.slice(0, args.bytes) : data
            let content: string
            try { content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes) }
            catch { throw new FsError("FS_NOT_TEXT", "File is not valid UTF-8 text") }
            if (args.format === "text" && !args.field) {
              process.stdout.write(content)
              process.exitCode = 0
              return
            }
            success({ path: args.file, bytes: contentBytes.byteLength, content, truncated }, { format: args.format })
          } catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "mb <volume>",
        "Create a Named Volume (make bucket)",
        (y) => y
          .positional("volume", { type: "string", demandOption: true, describe: "Named Volume root path, for example volume://shared_files" })
          .example("cz-cli fs mb volume://shared_files", "Create a Named Volume in the current workspace and schema")
          .example("cz-cli fs mb volume://public.myvol", "Create a Named Volume in a specific schema"),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try { await createFs(args).mb(args.volume); success({ path: args.volume, operation: "CREATE_VOLUME", status: "SUCCEEDED" }, { format: args.format }) }
          catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "mkdir <path>",
        "Create a directory and missing parents inside an existing filesystem or Volume",
        (y) => y
          .positional("path", { type: "string", demandOption: true, describe: "Local directory or directory path inside an existing Volume" })
          .example("cz-cli fs mkdir volume://my_volume/data/2026/08", "Create nested directories in an existing Named Volume")
          .example("cz-cli fs mkdir volume:user://~/data/2026/08", "Create nested directories in your User Volume"),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try { await createFs(args).mkdirs(args.path); success({ path: args.path, operation: "MKDIR", status: "SUCCEEDED" }, { format: args.format }) }
          catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "cp <source> <destination>",
        "Copy a file or directory",
        (y) => y
          .positional("source", { type: "string", demandOption: true, describe: "Source local or Volume path" })
          .positional("destination", { type: "string", demandOption: true, describe: "Destination local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Copy files in all subdirectories" })
          .option("overwrite", { type: "boolean", default: true, describe: "Replace existing destination files" }),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            const bytes = await createFs(args).copyBytes(args.source, args.destination, args.recursive, args.overwrite)
            success({ source: args.source, destination: args.destination, bytes, status: "SUCCEEDED" }, { format: args.format })
          } catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "mv <source> <destination>",
        "Move a file or directory",
        (y) => y
          .positional("source", { type: "string", demandOption: true, describe: "Source local or Volume path" })
          .positional("destination", { type: "string", demandOption: true, describe: "Destination local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Move files in all subdirectories" })
          .option("overwrite", { type: "boolean", default: true, describe: "Replace existing destination files" }),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try { await createFs(args).mv(args.source, args.destination, args.recursive, args.overwrite); success({ source: args.source, destination: args.destination, status: "SUCCEEDED" }, { format: args.format }) }
          catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "rm <path>",
        "Remove a file or directory",
        (y) => y
          .positional("path", { type: "string", demandOption: true, describe: "Local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Remove a directory and all files below it" })
          .option("force", { alias: "f", type: "boolean", default: false, describe: "Do not fail when the path does not exist" })
          .option("dry-run", { type: "boolean", default: false, describe: "List matched files without deleting them" }),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            const fs = createFs(args)
            if (args["dry-run"]) {
              try { await fs.validateRemoval(args.path, args.recursive) }
              catch (err) {
                if (args.force && err instanceof FsError && err.code === "FS_NOT_FOUND") {
                  success({ path: args.path, entries: [], dry_run: true, status: "WOULD_REMOVE" }, { format: args.format, rowsKey: "entries" })
                  return
                }
                throw err
              }
              const entries = await fs.ls(args.path, args.recursive)
              success({ path: args.path, entries: entries.map((entry) => ({ path: entry.path, name: entry.name, type: entry.isDir ? "directory" : "file", size_bytes: entry.size, modified_at: formatModifiedAt(entry.modificationTime) })), dry_run: true, status: "WOULD_REMOVE" }, { format: args.format, rowsKey: "entries" })
              return
            }
            try { await fs.rm(args.path, args.recursive) }
            catch (err) { if (!(args.force && err instanceof FsError && err.code === "FS_NOT_FOUND")) throw err }
            success({ path: args.path, operation: "REMOVE", status: "SUCCEEDED" }, { format: args.format })
          } catch (err) { reportFsError(err, args.format) }
        },
      ),
  )
}

function createFs(args: FsArgs): FsUtil {
  const config = resolveConnectionConfig(args)
  let context: ReturnType<typeof getExecContext> | undefined
  return new FsUtil({
    workspace: config.workspace,
    schema: config.schema,
    execute: async (sql, hints) => {
      const ctx = await (context ??= getExecContext(args))
      const result = await execSql(ctx, sql, { hints })
      if (!("rows" in result)) throw new FsError("FS_TRANSFER_FAILED", "Unexpected asynchronous SQL result")
      return result
    },
  })
}

function formatModifiedAt(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || Math.abs(value) > 8.64e15) return null
  return new Date(value).toISOString()
}

function reportFsError(err: unknown, format: string): void {
  if (err instanceof FsError) {
    const invalid = err.code.endsWith("_INVALID") || err.code === "FS_RECURSIVE_REQUIRED" || err.code === "FS_PATH_CONTEXT_REQUIRED"
    error(err.code, err.message, { format, exitCode: invalid ? 2 : 1, ...(err.details !== undefined ? { extra: { details: err.details } } : {}) })
    return
  }
  if (err instanceof InterfaceError && typeof err.code === "string" && err.code) {
    error(err.code, err.message, { format })
    return
  }
  const classified = classifyExecError(err)
  error(classified.code, classified.message, { format, ...(classified.aiMessage ? { aiMessage: classified.aiMessage } : {}) })
}

import type { Argv } from "yargs"
import { InterfaceError } from "@clickzetta/sdk"
import { FsError, FsUtil, isVolumeNamespaceRoot } from "@clickzetta/sdk/fsutil"
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
  write: boolean
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
          .positional("path", { type: "string", demandOption: true, describe: "Local path or czfs Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Include files in all subdirectories." })
          .option("limit", { type: "number", default: 100, describe: "Maximum entries to display; 0 means unlimited" })
          .epilogue(["Examples:", "  cz-cli fs ls czfs:/", "  cz-cli fs ls czfs:/Volumes/@user/your_workspace/your_user/", "  cz-cli fs ls czfs:/Volumes/@table/your_workspace/your_schema/your_table/ -R", "", "Namespace roots do not accept -R; use -R on a specific Volume or directory."].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            if (!Number.isInteger(args.limit) || args.limit < 0) throw new FsError("FS_LIMIT_INVALID", "--limit must be a non-negative integer")
            if (args.recursive && isVolumeNamespaceRoot(args.path)) throw new FsError("FS_PATH_INVALID", "--recursive is not supported for a Volume namespace root; list a specific Volume root or directory with -R")
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
          .option("bytes", { alias: "c", type: "number", default: 65536, describe: "Maximum bytes to read" })
          .epilogue(["Examples:", "  cz-cli fs head czfs:/Volumes/@user/your_workspace/your_user/demo.csv", "  cz-cli fs head ./app.log --bytes 1024"].join("\n")),
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
        "Create a Managed Volume (fs mb cannot create User or Table Volumes)",
        (y) => y
          .positional("volume", { type: "string", demandOption: true, describe: "Managed Volume root, e.g. czfs:/Volumes/your_workspace/your_schema/your_volume" })
          .epilogue(["Examples:", "  cz-cli fs mb czfs:/Volumes/your_workspace/your_schema/your_volume", "  cz-cli fs mb czfs:/Volumes/your_workspace/your_schema/raw_files"].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try { await createFs(args).mb(args.volume); success({ path: args.volume, operation: "CREATE_VOLUME", status: "SUCCEEDED" }, { format: args.format }) }
          catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "rb <volume>",
        "Remove an empty Managed Volume object (does not remove files)",
        (y) => y
          .positional("volume", { type: "string", demandOption: true, describe: "Managed Volume root" })
          .option("write", { type: "boolean", default: false, describe: "Allow removing the Volume object; required as a safety guard." })
          .epilogue(["Examples:", "  cz-cli fs rb czfs:/Volumes/your_workspace/your_schema/your_volume --write", "", "Only empty Managed Volumes can be removed; use fs rm for files first."].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            if (!args.write) throw new FsError("WRITE_NOT_ALLOWED", "Remove operation detected. Pass --write to confirm.")
            await createFs(args).rb(args.volume)
            success({ path: args.volume, operation: "DROP_VOLUME", status: "SUCCEEDED" }, { format: args.format })
          }
          catch (err) { reportFsError(err, args.format) }
        },
      )
      .command(
        "mkdir <path>",
        "Create a directory and missing parents inside an existing filesystem or Volume",
        (y) => y
          .positional("path", { type: "string", demandOption: true, describe: "Local directory or path inside an existing Volume" })
          .epilogue(["Examples:", "  cz-cli fs mkdir czfs:/Volumes/your_workspace/your_schema/your_volume/data/2026/08", "  cz-cli fs mkdir czfs:/Volumes/@user/your_workspace/your_user/data/2026/08", "  cz-cli fs mkdir czfs:/Volumes/@table/your_workspace/your_schema/your_table/data/2026/08"].join("\n")),
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
          .option("overwrite", { type: "boolean", default: false, describe: "Replace existing destination files (default: refuse existing targets)" })
          .epilogue(["Examples:", "  cz-cli fs cp ./data.csv \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/data.csv", "  cz-cli fs cp \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/data.csv \\", "    ./downloads/data.csv", "", "Existing targets are refused by default; add --overwrite to replace."].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            const bytes = await createFs(args).copyBytes(args.source, args.destination, args.recursive, args.overwrite)
            success({ source: args.source, destination: args.destination, bytes, status: "SUCCEEDED" }, { format: args.format })
          } catch (err) { reportFsError(err, args.format, "transfer") }
        },
      )
      .command(
        "mv <source> <destination>",
        "Move a file or directory",
        (y) => y
          .positional("source", { type: "string", demandOption: true, describe: "Source local or Volume path" })
          .positional("destination", { type: "string", demandOption: true, describe: "Destination local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Move files in all subdirectories" })
          .option("overwrite", { type: "boolean", default: false, describe: "Replace existing destination files (default: refuse existing targets)" })
          .epilogue(["Examples:", "  cz-cli fs mv \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/inbox.csv \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/archive.csv", "  cz-cli fs mv ./data \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/data -R", "", "Existing targets are refused by default; add --overwrite to replace."].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try { await createFs(args).mv(args.source, args.destination, args.recursive, args.overwrite); success({ source: args.source, destination: args.destination, status: "SUCCEEDED" }, { format: args.format }) }
          catch (err) { reportFsError(err, args.format, "transfer") }
        },
      )
      .command(
        "rm <path>",
        "Remove a file or directory",
        (y) => y
          .positional("path", { type: "string", demandOption: true, describe: "Local or Volume path" })
          .option("recursive", { alias: "R", type: "boolean", default: false, describe: "Remove a directory and all files below it" })
          .option("force", { alias: "f", type: "boolean", default: false, describe: "Do not fail when the path does not exist" })
          .option("dry-run", { type: "boolean", default: false, describe: "List matched files without deleting them" })
          .option("write", { type: "boolean", default: false, describe: "Allow removing files; required as a safety guard." })
          .epilogue(["Examples:", "  cz-cli fs rm \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/tmp/data.csv", "  cz-cli fs rm \\", "    czfs:/Volumes/your_workspace/your_schema/your_volume/tmp/ -R --dry-run", "", "Deletion is permanent; use --dry-run before recursive removal."].join("\n")),
        async (argv) => {
          const args = argv as unknown as FsArgs
          try {
            if (!args.write && !args["dry-run"]) throw new FsError("WRITE_NOT_ALLOWED", "Remove operation detected. Pass --write to confirm.")
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
      )
      .epilogue([
        "Path formats (use the czfs: qualifier for Volume paths):",
        "  Managed/External czfs:/Volumes/your_workspace/your_schema/your_volume/",
        "  User            czfs:/Volumes/@user/your_workspace/your_user/",
        "  Table           czfs:/Volumes/@table/your_workspace/your_schema/your_table/",
        "  @user and @table are required; @external and @managed are optional.",
        "  In @user paths, your_user is the Lakehouse username (usually the profile username), not the profile name.",
        "",
        "Volume workflows:",
        "  fs ls czfs:/                                      List Managed/External roots + @user + @table",
        "  fs ls czfs:/Volumes/@table/                      Enumerate Table Volume roots (SHOW TABLES)",
        "  fs ls czfs:/Volumes/@user/                       List User Volume workspaces (SHOW WORKSPACES)",
        "  ls also accepts partial namespace paths: @table/workspace/schema/, @user/workspace/, or workspace/schema/; use a full path for file operations.",
        "  Root metadata queries: SHOW VOLUMES | SHOW TABLES | SHOW USER VOLUME DIRECTORY",
        "  fs mb czfs:/Volumes/your_workspace/your_schema/your_volume Create a Managed Volume only",
        "  fs rb czfs:/Volumes/your_workspace/your_schema/your_volume Remove an empty Managed Volume object (requires --write)",
        "  Table Volumes are created automatically with tables; User Volumes are system-created.",
        "  Use fs mkdir/cp/ls/rm inside an existing Volume. Files are separate from Volume objects.",
        "  fs rb refuses External Volumes and non-empty Managed Volumes; remove files with fs rm first.",
        "  fs mb/rb require a qualified czfs:/Volumes/your_workspace/your_schema/your_volume root, not a bare name.",
        "  Namespace roots do not accept -R; use -R only on a specific Volume/file tree.",
      ].join("\n")),
  )
}

function createFs(args: FsArgs): FsUtil {
  const config = resolveConnectionConfig(args)
  let context: ReturnType<typeof getExecContext> | undefined
  return new FsUtil({
    workspace: config.workspace,
    schema: config.schema,
    execute: async (sql, hints) => {
      if (args.debug) process.stderr.write(`[debug] fs sql: ${sql}\n`)
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

function reportFsError(err: unknown, format: string, operation?: "transfer"): void {
  if (err instanceof FsError) {
    const invalid = err.code.endsWith("_INVALID") || err.code === "FS_RECURSIVE_REQUIRED" || err.code === "FS_PATH_CONTEXT_REQUIRED" || err.code === "WRITE_NOT_ALLOWED"
    const message = operation === "transfer" && err.code === "FS_TARGET_EXISTS"
      ? `${err.message}. Use --overwrite to replace it or choose a different destination.`
      : err.message
    error(err.code, message, { format, exitCode: invalid ? 2 : 1, ...(err.details !== undefined ? { extra: { details: err.details } } : {}) })
    return
  }
  if (err instanceof InterfaceError && typeof err.code === "string" && err.code) {
    error(err.code, err.message, { format })
    return
  }
  const classified = classifyExecError(err)
  error(classified.code, classified.message, { format, ...(classified.aiMessage ? { aiMessage: classified.aiMessage } : {}) })
}

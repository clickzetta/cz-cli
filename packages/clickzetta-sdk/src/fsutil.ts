import { mkdir, open, readdir, rename, rm as removeFile, stat, writeFile } from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import { pipeline } from "node:stream/promises"
import { Readable } from "node:stream"
import { dirname, join, basename, relative, resolve as resolvePath, sep } from "node:path"
import { randomUUID } from "node:crypto"
import type { QueryResult } from "./sql/types.js"
import { quote } from "./sql/literal.js"
import { executeVolumeTransferWithRetry } from "./sql/volume.js"

export interface FsUtilOptions {
  execute: (sql: string, hints?: Record<string, string>) => Promise<QueryResult>
  workspace?: string
  schema?: string
}

export interface FileInfo {
  path: string
  name: string
  size: number
  modificationTime: number | null
  isDir: boolean
}

export class FsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type VolumeKind = "named" | "table" | "user"

interface CopyProgress {
  completed: Array<{ source: string; destination: string; bytes: number }>
}

export interface VolumeReference {
  kind: VolumeKind
  identifiers: string[]
  czfsBase?: string
}

interface FsPath {
  readonly original: string
  readonly identity: string
  readonly isLocal: boolean
  readonly isRoot: boolean
  readonly scope: string
  readonly scopePath: string
  exists(): Promise<boolean>
  info(): Promise<FileInfo>
  children(recursive: boolean, limit?: number): Promise<FsPath[]>
  child(path: string): FsPath
  read(maxBytes?: number): Promise<Uint8Array>
  write(content: AsyncIterable<Uint8Array> | Uint8Array, overwrite: boolean, contentLength?: number): Promise<void>
  mkdirs(): Promise<void>
  copyTo(target: FsPath, recursive: boolean, overwrite: boolean): Promise<number>
  remove(recursive: boolean): Promise<void>
}

function quoteIdentifier(value: string): string {
  return "`" + value.replace(/`/g, "``") + "`"
}

export function quoteIdentifiers(identifiers: string[]): string {
  return identifiers.map(quoteIdentifier).join(".")
}

function volumeDefinitionIdentifier(reference: VolumeReference): string {
  return quoteIdentifiers(reference.identifiers)
}

export function parseVolumePath(input: string): { reference: VolumeReference; relativePath: string } | undefined {
  const path = String(input)
  const lower = path.toLowerCase()
  const czfsPath = lower.startsWith("czfs:") ? path.slice(5) : undefined
  if (!(lower.startsWith("volume://") || lower.startsWith("volume:table://") || lower.startsWith("volume:user://") || /^\/volumes?(?:\/|$)/i.test(czfsPath ?? ""))) return undefined

  const separator = path.indexOf("://")
  if (separator >= 0) {
    const scheme = path.slice(0, separator).toLowerCase()
    const rest = path.slice(separator + 3)
    if ((scheme === "volume" || scheme === "volume:table") && rest.replace(/\/+$/, "") === "") {
      return { reference: { kind: scheme === "volume:table" ? "table" : "named", identifiers: [] }, relativePath: "" }
    }
    const slash = rest.indexOf("/")
    const netloc = slash < 0 ? rest : rest.slice(0, slash)
    const relativePath = slash < 0 ? "" : decodeUriComponent(rest.slice(slash + 1), path)
    if (!netloc) throw new FsError("FS_PATH_INVALID", `Volume path requires a volume name: ${path}`)
    if (scheme === "volume:user") {
      if (netloc !== "~") throw new FsError("FS_PATH_INVALID", `User volume path must be volume:user://~/<path>`)
      return { reference: { kind: "user", identifiers: [] }, relativePath }
    }
    const identifiers = netloc.split(".").map((value) => decodeUriComponent(value, path))
    validateIdentifiers(identifiers, path)
    if (identifiers.some((value) => value.length === 0) || identifiers.length > 3) {
      throw new FsError("FS_PATH_INVALID", `Volume name must contain between one and three identifiers: ${path}`)
    }
    const kind: VolumeKind = scheme === "volume:table" ? "table" : "named"
    if (kind === "table" && identifiers.length !== 3) throw new FsError("FS_PATH_INVALID", `Table volume path requires workspace.schema.table: ${path}`)
    const czfsBase = identifiers.length === 3
      ? buildCzfsBase(kind, identifiers)
      : undefined
    return { reference: { kind, identifiers, czfsBase }, relativePath }
  }

  const rawComponents = czfsPath!.split("/")
  while (rawComponents.length > 0 && rawComponents[rawComponents.length - 1] === "") rawComponents.pop()
  if (rawComponents.length < 2 || rawComponents[0] !== "" || !/^volumes?$/i.test(rawComponents[1]!)) {
    throw new FsError("FS_PATH_INVALID", `Invalid czfs path: ${path}`)
  }
  const components = rawComponents.slice(2).map((value) => decodeUriComponent(value, path))
  if (components.length === 0) return { reference: { kind: "named", identifiers: [] }, relativePath: "" }
  const marker = components[0]?.toLowerCase() ?? ""
  let values = components
  if (marker === "@external" || marker === "@managed") values = components.slice(1)
  else if (marker === "@table" || marker === "@user") values = components.slice(1)
  else if (marker.startsWith("@")) throw new FsError("FS_PATH_INVALID", `Unsupported Volume type '${components[0]}' in ${path}`)
  const kind: VolumeKind = marker === "@table" ? "table" : marker === "@user" ? "user" : "named"
  const count = kind === "user" ? 2 : 3
  if (values.length < count || values.slice(0, count).some((value) => !value)) {
    const hint = kind === "table" ? " Use czfs:/Volumes/@table/ to list Table Volume roots." : kind === "user" ? " Use czfs:/Volumes/@user/ to list the current User Volume." : ""
    throw new FsError("FS_PATH_INVALID", `czfs path requires all volume identifiers: ${path}${hint}`)
  }
  const identifiers = values.slice(0, count)
  validateIdentifiers(identifiers, path)
  return {
    reference: { kind, identifiers, czfsBase: buildCzfsBase(kind, identifiers) },
    relativePath: values.slice(count).join("/"),
  }
}

export function isVolumeNamespaceRoot(input: string): boolean {
  const normalized = String(input).toLowerCase().replace(/\/+$/, "")
  const canonical = normalized.startsWith("czfs:") ? `czfs:${normalized.slice(5).replace(/^\/volume(?=\/|$)/, "/volumes")}` : normalized
  if (canonical === "czfs:" || canonical === "czfs:/volumes" || canonical === "volume:" || canonical === "volume:table:") return true
  const namespace = parseCzfsNamespacePath(input)
  return namespace !== undefined && (namespace.kind !== "user" || namespace.identifiers.length === 0)
}

interface CzfsNamespacePath {
  kind: VolumeKind
  identifiers: string[]
}

function parseCzfsNamespacePath(input: string): CzfsNamespacePath | undefined {
  const path = String(input)
  if (!path.toLowerCase().startsWith("czfs:")) return undefined
  const rest = path.slice(5)
  if (!/^\/volumes?(?:\/|$)/i.test(rest)) return undefined
  const raw = rest.split("/")
  while (raw.length > 0 && raw[raw.length - 1] === "") raw.pop()
  const components = raw.slice(2).map((value) => decodeUriComponent(value, path))
  if (components.length === 0) return undefined
  const marker = components[0]?.toLowerCase() ?? ""
  const kind: VolumeKind = marker === "@table" ? "table" : marker === "@user" ? "user" : "named"
  const values = marker.startsWith("@") ? components.slice(1) : components
  if (marker.startsWith("@") && !["@external", "@managed", "@table", "@user"].includes(marker)) {
    throw new FsError("FS_PATH_INVALID", `Unsupported Volume type '${components[0]}' in ${path}`)
  }
  const required = kind === "user" ? 2 : 3
  if (values.length >= required) return undefined
  validateIdentifiers(values, path)
  return { kind, identifiers: values }
}

export function validateRelativePath(path: string, original: string): string {
  if (!path) return ""
  const normalized = path.replace(/\/+$/, "")
  const parts = normalized.split("/")
  if (!normalized || /[\u0000-\u001f\u007f]/.test(normalized) || parts.some((part) => part === "" || part === "." || part === "..")) throw new FsError("FS_PATH_INVALID", `Invalid path segment in ${original}`)
  return parts.join("/")
}

function decodeUriComponent(value: string, original: string): string {
  try { return decodeURIComponent(value) }
  catch { throw new FsError("FS_PATH_INVALID", `Invalid URL encoding in ${original}`) }
}

function mapLocalError(error: unknown, path: string): FsError {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""
  if (code === "ENOENT") return new FsError("FS_NOT_FOUND", `Path not found: ${path}`)
  if (code === "EEXIST") return new FsError("FS_TARGET_EXISTS", `Target already exists: ${path}`)
  if (code === "EISDIR" || code === "ENOTDIR") return new FsError("FS_IS_DIRECTORY", `Path type is incompatible: ${path}`)
  if (code === "EACCES" || code === "EPERM") return new FsError("FS_PERMISSION_DENIED", `Permission denied: ${path}`)
  return new FsError("FS_TRANSFER_FAILED", error instanceof Error ? error.message : String(error))
}

function mapHttpError(status: number, operation: string, path: string): FsError {
  if (status === 404) return new FsError("FS_NOT_FOUND", `Path not found: ${path}`)
  if (status === 401 || status === 403) return new FsError("FS_PERMISSION_DENIED", `Permission denied while ${operation}: ${path}`)
  return new FsError("FS_TRANSFER_FAILED", `HTTP ${status} while ${operation}: ${path}`)
}

function validateIdentifiers(identifiers: string[], original: string): void {
  if (identifiers.some((value) => !value || value === "." || value === ".." || value.includes(".") || value.includes("/") || /[\u0000-\u001f\u007f]/.test(value))) {
    throw new FsError("FS_PATH_INVALID", `Invalid Volume identifier in ${original}`)
  }
}

function buildCzfsBase(kind: VolumeKind, identifiers: string[]): string {
  const marker = kind === "table" ? "@table/" : kind === "user" ? "@user/" : ""
  return `czfs:/Volumes/${marker}${identifiers.map(encodeURIComponent).join("/")}`
}

function volumeIdentifier(reference: VolumeReference): string {
  const prefix = reference.kind === "table" ? "table volume" : reference.kind === "user" ? "user volume" : "volume"
  if (reference.kind === "user" && reference.identifiers.length === 0) return prefix
  return `${prefix} ${reference.identifiers.map(quoteIdentifier).join(".")}`
}

function volumeUri(reference: VolumeReference, path: string): string {
  const base = reference.czfsBase ?? `${reference.kind === "table" ? "volume:table" : reference.kind === "user" ? "volume:user" : "volume"}://${reference.identifiers.length ? reference.identifiers.map(encodeURIComponent).join(".") : "~"}`
  return path ? `${base}/${path.split("/").map(encodeURIComponent).join("/")}` : base
}

function qualifyNamedVolume(reference: VolumeReference, workspace: string | undefined, schema: string | undefined, original: string): VolumeReference {
  if (reference.identifiers.length === 3) return reference
  if (!workspace || !schema) throw new FsError("FS_PATH_CONTEXT_REQUIRED", `Workspace and schema are required for short Volume path: ${original}`)
  const identifiers = reference.identifiers.length === 1
    ? [workspace, schema, reference.identifiers[0]!]
    : [workspace, ...reference.identifiers]
  return { ...reference, identifiers, czfsBase: buildCzfsBase(reference.kind, identifiers) }
}

function parseLocalPath(path: string): string {
  if (path.slice(0, "file:".length).toLowerCase() === "file:") {
    const value = path.slice("file:".length)
    if (value.startsWith("///")) return "/" + value.slice(3)
    if (value.startsWith("//")) return "/" + value.slice(2)
    if (value.startsWith("/")) return value
    return resolvePath(value)
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !/^[A-Za-z]:[\\/]/.test(path)) {
    throw new FsError("FS_PATH_INVALID", `Unsupported path scheme: ${path}`)
  }
  return resolvePath(path)
}

function iterableToReadableStream(content: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = content[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      const next = await iterator.next()
      if (next.done) controller.close()
      else controller.enqueue(next.value)
    },
    async cancel() { await iterator.return?.() },
  })
}

function contentToReadable(content: AsyncIterable<Uint8Array>): NodeJS.ReadableStream {
  return Readable.from(content)
}

async function collectBytes(content: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for await (const chunk of content) {
    chunks.push(chunk)
    total += chunk.byteLength
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function parseModificationTime(value: unknown): number | null {
  const maxDateMs = 8.64e15
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= maxDateMs ? value : null
  if (typeof value === "string") {
    // SHOW ... DIRECTORY returns "" for rows with no timestamp. Number("") is 0, which
    // would otherwise be reported as 1970-01-01 instead of "unknown".
    if (value.trim() === "") return null
    const numeric = Number(value)
    if (Number.isFinite(numeric) && Math.abs(numeric) <= maxDateMs) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && Math.abs(parsed) <= maxDateMs) return parsed
  }
  return null
}

function parseVolumeRecord(raw: unknown, description: string, path: string): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {}
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>
  throw new FsError("FS_TRANSFER_FAILED", `Invalid ${description} for ${path}`)
}

// A missing path must map to FS_NOT_FOUND, but a missing SQL *function* means the
// engine lacks the capability and must surface as FS_TRANSFER_FAILED — reporting it
// as "not found" would let `fs ls` claim a populated directory is empty.
function isMissingVolumePathError(message: string): boolean {
  if (/\b(?:unknown|unresolved|undefined) function\b/i.test(message)) return false
  if (/\bfunction\b[^\n]*(?:not found|does not exist|not registered)/i.test(message)) return false
  const normalized = message.trim()
  if (/^(?:not found|does not exist)$/i.test(normalized)) return true
  if (/\bunknown\s+volume\b/i.test(message)) return true
  return /\b(?:path|file|directory|subdirectory|volume)\b[^\n]*(?:not found|does not exist|unknown)/i.test(message)
}

function isEmptyManagedVolumeRootError(message: string): boolean {
  return /CZLH-70002\s*:\s*Path not found:[\s\S]*\/volumes\/[^\n]*\/\.$/i.test(message.trim())
}

async function managedVolumeExists(
  reference: VolumeReference,
  execute: (sql: string, hints?: Record<string, string>) => Promise<QueryResult>,
): Promise<boolean> {
  const result = await execute("SHOW VOLUMES")
  if (result.status === "FAILED") return false
  const expectedWorkspace = reference.identifiers[0]
  const expectedSchema = reference.identifiers[1]
  const expectedName = reference.identifiers[2]
  return result.rows.some((row) => {
    const name = String(resultValue(result, row, "volume_name", "name") ?? "")
    const schema = String(resultValue(result, row, "schema_name", "schema") ?? "")
    const workspace = String(resultValue(result, row, "workspace_name", "workspace") ?? "")
    return name === expectedName && schema === expectedSchema && workspace === expectedWorkspace
  })
}

function resultRecord(result: QueryResult, row: unknown[]): Record<string, unknown> {
  return Object.fromEntries(result.columns.map((column, index) => [column.name.toLowerCase(), row[index]]))
}

function resultValue(result: QueryResult, row: unknown[], ...names: string[]): unknown {
  const record = resultRecord(result, row)
  for (const name of names) {
    const value = record[name.toLowerCase()]
    if (value !== undefined && value !== null && value !== "") return value
  }
  return undefined
}

function volumeEntry(reference: VolumeReference, relativePath: string, value: Record<string, unknown>, isDir?: boolean): FileInfo {
  const directory = isDir ?? relativePath.endsWith("/")
  const normalized = relativePath.replace(/^\/+|\/+$/g, "")
  return {
    path: volumeUri(reference, normalized),
    name: normalized ? basename(normalized) : (reference.identifiers.at(-1) ?? ""),
    size: Number(value.size ?? value.size_bytes ?? 0),
    modificationTime: parseModificationTime(value.last_modified_time ?? value.modified_at ?? value.mtime ?? value.create_time),
    isDir: directory,
  }
}

function httpTransferError(status: number, operation: string, path: string): Error & { status: number } {
  const error = new Error(`HTTP ${status} while ${operation}: ${path}`) as Error & { status: number }
  error.status = status
  return error
}

function mapHttpTransferFailure(error: unknown, operation: string, path: string): never {
  if (error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number") {
    throw mapHttpError((error as { status: number }).status, operation, path)
  }
  throw error
}

class LocalFsPath implements FsPath {
  readonly isLocal = true
  readonly scope = "local"
  readonly scopePath: string
  readonly isRoot: boolean
  readonly identity: string
  constructor(readonly original: string, private readonly path: string) {
    this.identity = `local:${this.path}`
    this.isRoot = dirname(this.path) === this.path
    this.scopePath = this.path
  }
  async exists() {
    return stat(this.path).then(() => true).catch((error) => {
      if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return false
      throw mapLocalError(error, this.original)
    })
  }
  child(path: string) { return new LocalFsPath(join(this.path, path), join(this.path, path)) }
  async info(): Promise<FileInfo> {
    const info = await stat(this.path).catch((error) => { throw mapLocalError(error, this.original) })
    return { path: `file:${this.path}`, name: basename(this.path), size: info.size, modificationTime: Math.trunc(info.mtimeMs), isDir: info.isDirectory() }
  }
  async children(recursive: boolean, limit = 0): Promise<FsPath[]> {
    const info = await this.info()
    if (!info.isDir) return [this]
    const entries = await readdir(this.path, { withFileTypes: true }).catch((error) => { throw mapLocalError(error, this.original) })
    const result: FsPath[] = []
    for (const entry of entries) {
      const child = new LocalFsPath(join(this.path, entry.name), join(this.path, entry.name))
      if (entry.isDirectory()) {
        result.push(child)
        if (!recursive) continue
        if (limit > 0 && result.length >= limit) break
        const remaining = limit > 0 ? Math.max(limit - result.length, 0) : 0
        result.push(...await child.children(true, remaining))
        if (limit > 0 && result.length >= limit) break
      }
      else result.push(child)
      if (limit > 0 && result.length >= limit) break
    }
    return limit > 0 ? result.slice(0, limit) : result
  }
  async read(maxBytes = 65536) {
    const info = await stat(this.path).catch((error) => { throw mapLocalError(error, this.original) })
    const handle = await open(this.path, "r").catch((error) => { throw mapLocalError(error, this.original) })
    try {
      const buffer = new Uint8Array(Math.min(maxBytes, info.size + 1))
      let offset = 0
      while (offset < maxBytes) {
        const result = await handle.read(buffer, offset, buffer.length - offset, offset).catch((error) => { throw mapLocalError(error, this.original) })
        if (result.bytesRead === 0) break
        offset += result.bytesRead
      }
      return buffer.slice(0, offset)
    } finally { await handle.close() }
  }
  async write(content: AsyncIterable<Uint8Array> | Uint8Array, overwrite: boolean, _contentLength?: number) {
    if (!overwrite && await this.exists()) throw new FsError("FS_TARGET_EXISTS", `Target already exists: ${this.original}`)
    await mkdir(dirname(this.path), { recursive: true }).catch((error) => { throw mapLocalError(error, dirname(this.path)) })
    if (content instanceof Uint8Array) {
      await writeFile(this.path, content).catch((error) => { throw mapLocalError(error, this.original) })
      return
    }
    await pipeline(contentToReadable(content), createWriteStream(this.path)).catch((error) => { throw mapLocalError(error, this.original) })
  }
  async mkdirs() { await mkdir(this.path, { recursive: true }).catch((error) => { throw mapLocalError(error, this.original) }) }
  async copyTo(target: FsPath, recursive: boolean, overwrite: boolean) {
    const info = await this.info()
    if (info.isDir && !recursive) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory copy requires recursive flag: ${this.original}`)
    return target.write(this.readChunks(info.isDir ? recursive : false), overwrite, info.size).then(() => info.size)
  }
  private async *readChunks(isDirectory: boolean): AsyncIterable<Uint8Array> {
    if (isDirectory) throw new FsError("FS_INTERNAL_ERROR", "Directory stream is not supported")
    for await (const chunk of createReadStream(this.path)) yield chunk as Uint8Array
  }
  async remove(recursive: boolean) {
    if (this.isRoot) throw new FsError("FS_PATH_INVALID", `Cannot remove filesystem root: ${this.original}`)
    const info = await this.info()
    if (info.isDir && !recursive) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory removal requires recursive flag: ${this.original}`)
    await removeFile(this.path, { recursive, force: false }).catch((error) => { throw mapLocalError(error, this.original) })
  }
}

class VolumeFsPath implements FsPath {
  readonly isLocal = false
  readonly scope: string
  readonly scopePath: string
  readonly isRoot: boolean
  readonly identity: string
  constructor(readonly original: string, private readonly reference: VolumeReference, private readonly relativePath: string, private readonly execute: (sql: string, hints?: Record<string, string>) => Promise<QueryResult>, private readonly cachedInfo?: FileInfo) {
    this.identity = `volume:${reference.kind}:${reference.identifiers.join(".")}:${relativePath}`
    this.isRoot = relativePath === ""
    this.scope = `volume:${reference.kind}:${reference.identifiers.join(".")}`
    this.scopePath = relativePath
  }
  private async query(sql: string, hints?: Record<string, string>): Promise<unknown[][]> {
    const result = await this.execute(sql, hints)
    if (result.status === "FAILED") {
      const message = result.errorMessage ?? `Volume SQL failed: ${sql}`
      if (this.reference.kind === "named" && sql.toLowerCase().startsWith("select list_directory") && isEmptyManagedVolumeRootError(message) && await managedVolumeExists(this.reference, this.execute)) return []
      if (isMissingVolumePathError(message)) throw new FsError("FS_NOT_FOUND", message)
      throw new FsError("FS_TRANSFER_FAILED", message)
    }
    return result.rows
  }
  private async url(method: "GET" | "PUT") {
    const rows = await this.query(`select get_presigned_url(${volumeIdentifier(this.reference)}, ${quote(this.relativePath)}, 3600, ${quote(method)})`, { "cz.sql.function.get.presigned.url.force.external": "true" })
    const value = rows[0]?.[0]
    if (typeof value !== "string" || !value) throw new FsError("FS_NOT_FOUND", `Path not found: ${this.original}`)
    return value
  }
  async exists() {
    return this.info().then(() => true).catch((error) => {
      if (error instanceof FsError && error.code === "FS_NOT_FOUND") return false
      throw error
    })
  }
  child(path: string) {
    const childPath = this.relativePath ? `${this.relativePath}/${path}` : path
    return new VolumeFsPath(volumeUri(this.reference, childPath), this.reference, childPath, this.execute)
  }
  async info(): Promise<FileInfo> {
    if (this.cachedInfo) return this.cachedInfo
    if (!this.relativePath) return { path: volumeUri(this.reference, ""), name: "", size: 0, modificationTime: null, isDir: true }
    const rows = await this.query(`select get_file(${volumeIdentifier(this.reference)}, ${quote(this.relativePath)})`)
    const raw = rows[0]?.[0]
    if (raw == null) throw new FsError("FS_NOT_FOUND", `Path not found: ${this.original}`)
    const value = parseVolumeRecord(raw, "file metadata", this.original)
    const path = String(value.path ?? this.relativePath).replace(/\/+$/, "")
    return { path: volumeUri(this.reference, path), name: basename(path), size: Number(value.size ?? 0), modificationTime: parseModificationTime(value.mtime), isDir: Boolean(value.dir ?? value.is_dir ?? value.isDir) }
  }
  async children(recursive: boolean, limit = 0): Promise<FsPath[]> {
    const info = await this.info()
    if (!info.isDir) return [this]
    if (!this.relativePath) return listVolumeDirectory(this.reference, this.original, this.execute, recursive, limit)
    // Volume roots are handled above, so relativePath is always non-empty here.
    const rows = await this.query(`select list_directory(${volumeIdentifier(this.reference)}, ${quote(this.relativePath)}, ${recursive ? "true" : "false"})${limit > 0 ? ` limit ${limit}` : ""}`)
    const seen = new Set<string>()
    const entries = rows.flatMap((row) => {
      const raw = row[0]
      const value = parseVolumeRecord(raw, "directory entry", this.original)
      const path = String(value.path ?? "")
      if (!path) return []
      const normalizedPath = validateRelativePath(path, this.original)
      if (seen.has(normalizedPath)) return []
      seen.add(normalizedPath)
      const info: FileInfo = {
        path: volumeUri(this.reference, normalizedPath),
        name: basename(normalizedPath),
        size: Number(value.size ?? 0),
        modificationTime: parseModificationTime(value.mtime),
        isDir: Boolean(value.dir ?? value.is_dir ?? value.isDir),
      }
      return [new VolumeFsPath(info.path, this.reference, normalizedPath, this.execute, info)]
    })
    return limit > 0 ? entries.slice(0, limit) : entries
  }
  async read(maxBytes = 65536) {
    try {
      return await executeVolumeTransferWithRetry("GET", this.original, async () => {
        const response = await fetch(await this.url("GET"))
        if (!response.ok) throw httpTransferError(response.status, "reading", this.original)
        if (!response.body) throw new FsError("FS_TRANSFER_FAILED", `Missing response body while reading: ${this.original}`)
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let total = 0
        while (total < maxBytes) {
          const next = await reader.read()
          if (next.done) break
          const chunk = next.value.slice(0, maxBytes - total)
          chunks.push(chunk)
          total += chunk.length
          if (chunk.length < next.value.length) break
        }
        await reader.cancel()
        const result = new Uint8Array(total)
        let offset = 0
        for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
        return result
      })
    } catch (error) {
      return mapHttpTransferFailure(error, "reading", this.original)
    }
  }
  async write(content: AsyncIterable<Uint8Array> | Uint8Array, overwrite: boolean, contentLength?: number) {
    if (!this.relativePath) throw new FsError("FS_PATH_INVALID", "Cannot write a Volume root")
    const existing = await this.info().catch((error) => {
      if (error instanceof FsError && error.code === "FS_NOT_FOUND") return undefined
      throw error
    })
    if (existing?.isDir) throw new FsError("FS_IS_DIRECTORY", `Target is a directory: ${this.original}`)
    if (existing && !overwrite) throw new FsError("FS_TARGET_EXISTS", `Target already exists: ${this.original}`)
    const data = content instanceof Uint8Array ? content : await collectBytes(content)
    const body = new Blob([data as unknown as BlobPart])
    // Keep this header intentionally: the backing cloud is not exposed by the
    // Volume API, and the quick_start.public Managed Volume path was validated
    // with it. Deriving provider-specific headers would require another contract.
    const headers: Record<string, string> = { "x-ms-blob-type": "BlockBlob" }
    headers["content-length"] = String(contentLength ?? data.byteLength)
    try {
      await executeVolumeTransferWithRetry("PUT", this.original, async () => {
        const response = await fetch(await this.url("PUT"), { method: "PUT", body, headers, duplex: "half" } as RequestInit & { duplex: "half" })
        if (!response.ok) throw httpTransferError(response.status, "writing", this.original)
      })
    } catch (error) {
      mapHttpTransferFailure(error, "writing", this.original)
    }
  }
  async mkdirs() {
    if (!this.relativePath) throw new FsError("FS_PATH_INVALID", `Cannot create a Volume root with fs mkdir; create a Managed Volume with fs mb or specify a directory path inside an existing Volume: ${this.original}`)
    const rows = await this.query(`select create_directory(${volumeIdentifier(this.reference)}, ${quote(this.relativePath)}, true)`)
    const raw = rows[0]?.[0]
    const value = parseVolumeRecord(raw, "create directory response", this.original)
    if (!value || value.success !== true) throw new FsError("FS_TRANSFER_FAILED", `Failed to create directory: ${this.original}`)
  }
  async copyTo(target: FsPath, recursive: boolean, overwrite: boolean) {
    const info = await this.info()
    if (info.isDir && !recursive) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory copy requires recursive flag: ${this.original}`)
    if (!overwrite && await target.exists()) throw new FsError("FS_TARGET_EXISTS", `Target already exists: ${target.original}`)
    let bytes = 0
    try {
      await executeVolumeTransferWithRetry("GET", this.original, async () => {
        const response = await fetch(await this.url("GET"))
        if (!response.ok) throw httpTransferError(response.status, "reading", this.original)
        if (!response.body) throw new FsError("FS_TRANSFER_FAILED", `Missing response body while reading: ${this.original}`)
        let attemptBytes = 0
        const stream = (async function* () {
          const reader = response.body!.getReader()
          try {
            while (true) {
              const next = await reader.read()
              if (next.done) break
              attemptBytes += next.value.length
              yield next.value
            }
          } finally {
            await reader.cancel().catch(() => undefined)
          }
        })()
        await target.write(stream, overwrite, info.size)
        bytes = attemptBytes
      })
    } catch (error) {
      mapHttpTransferFailure(error, "reading", this.original)
    }
    return bytes
  }
  async remove(recursive: boolean) {
    if (this.isRoot) throw new FsError("FS_PATH_INVALID", `Cannot remove Volume root: ${this.original}`)
    const info = await this.info()
    if (info.isDir && !recursive) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory removal requires recursive flag: ${this.original}`)
    const command = info.isDir ? "subdirectory" : "file"
    await this.query(`remove ${volumeIdentifier(this.reference)} ${command} ${quote(this.relativePath)}`)
  }
}

async function listVolumeDirectory(
  reference: VolumeReference,
  original: string,
  execute: (sql: string, hints?: Record<string, string>) => Promise<QueryResult>,
  recursive: boolean,
  limit: number,
): Promise<FsPath[]> {
  const identifier = reference.identifiers.map(quoteIdentifier).join(".")
  const sql = reference.kind === "user"
    ? "SHOW USER VOLUME DIRECTORY"
    : reference.kind === "table"
      ? `SHOW TABLE VOLUME DIRECTORY ${identifier}`
      : `SHOW VOLUME DIRECTORY ${identifier}`
  const result = await execute(sql)
  if (result.status === "FAILED") {
    const message = result.errorMessage ?? `Volume directory query failed: ${original}`
    // The engine currently reports an existing empty Managed Volume root as a
    // physical "Path not found" (CZLH-70002). Treat that specific root response
    // as an empty listing, while preserving real missing-volume errors.
    if (reference.kind === "named" && isEmptyManagedVolumeRootError(message) && await managedVolumeExists(reference, execute)) return []
    if (isMissingVolumePathError(message)) throw new FsError("FS_NOT_FOUND", message)
    throw new FsError("FS_TRANSFER_FAILED", message)
  }

  const entries = new Map<string, FileInfo>()
  const hasPathColumn = result.columns.some((column) => ["relative_path", "path", "file"].includes(column.name.toLowerCase()))
  if (result.rows.length > 0 && !hasPathColumn) throw new FsError("FS_TRANSFER_FAILED", `Volume directory query returned no path column: ${original}`)
  for (const row of result.rows) {
    const rawPath = resultValue(result, row, "relative_path", "path", "file")
    if (rawPath === undefined || rawPath === null || String(rawPath).trim() === "") throw new FsError("FS_TRANSFER_FAILED", `Volume directory query returned an invalid path row: ${original}`)
    const rowPath = String(rawPath).replace(/^\/+/, "")
    // Apply the same guard as the list_directory branch: a server-supplied "../.."
    // must never become a local write target during `fs cp <volume root> ./out -R`.
    const normalized = validateRelativePath(rowPath, original)
    if (!normalized) continue
    const parts = normalized.split("/")
    const value = resultRecord(result, row)
    const rowIsDir = Boolean(value.dir ?? value.is_dir ?? value.isdir) || rowPath.endsWith("/")
    const add = (relativePath: string, metadata: Record<string, unknown>, isDir: boolean) => {
      if (!entries.has(relativePath)) entries.set(relativePath, volumeEntry(reference, relativePath, metadata, isDir))
    }
    if (recursive) {
      for (let index = 1; index < parts.length; index++) add(parts.slice(0, index).join("/"), {}, true)
      add(normalized, value, rowIsDir)
    } else {
      // Key on the normalized first segment so a "logs/" marker row and a
      // "logs/app.txt" row collapse into one directory entry.
      add(parts[0]!, parts.length === 1 ? value : {}, parts.length > 1 || rowIsDir)
    }
    // SHOW ... DIRECTORY takes no LIMIT clause, so stop scanning past the cap.
    if (limit > 0 && entries.size > limit) break
  }
  // Carry the decoded map key as the SQL relative path. info.path is percent-encoded
  // for display, and slicing it would send "a%20b.csv" to get_presigned_url/get_file.
  const paths = [...entries].map(([relativePath, info]) => new VolumeFsPath(info.path, reference, relativePath, execute, info))
  return limit > 0 ? paths.slice(0, limit) : paths
}

export class FsUtil {
  private readonly execute: (sql: string, hints?: Record<string, string>) => Promise<QueryResult>
  private readonly workspace?: string
  private readonly schema?: string
  constructor(options: FsUtilOptions) {
    this.execute = options.execute
    this.workspace = options.workspace
    this.schema = options.schema
  }
  path(input: string): FsPath {
    const volume = parseVolumePath(input)
    if (volume) {
      if (volume.reference.kind !== "user" && volume.reference.identifiers.length === 0) throw new FsError("FS_PATH_INVALID", `Volume root is only valid for fs ls: ${input}`)
      if (volume.reference.kind === "named" && volume.reference.identifiers.length < 3) {
        if (!this.workspace || !this.schema) throw new FsError("FS_PATH_CONTEXT_REQUIRED", `Workspace and schema are required for short Volume path: ${input}`)
        volume.reference.identifiers = volume.reference.identifiers.length === 1
          ? [this.workspace, this.schema, ...volume.reference.identifiers]
          : [this.workspace, ...volume.reference.identifiers]
        volume.reference.czfsBase = buildCzfsBase(volume.reference.kind, volume.reference.identifiers)
      }
      return new VolumeFsPath(input, volume.reference, validateRelativePath(volume.relativePath, input), this.execute)
    }
    return new LocalFsPath(input, parseLocalPath(input))
  }
  async info(path: string) { return this.path(path).info() }
  async mb(path: string) {
    const volume = parseVolumePath(path)
    if (!volume || volume.reference.kind !== "named" || volume.reference.identifiers.length === 0 || volume.relativePath) {
      throw new FsError("FS_PATH_INVALID", `fs mb expects a Managed Volume root in the form czfs:/Volumes/<workspace>/<schema>/<volume>; received '${path}'.`)
    }
    const reference = qualifyNamedVolume(volume.reference, this.workspace, this.schema, path)
    const result = await this.execute(`create volume ${volumeDefinitionIdentifier(reference)}`)
    if (result.status === "FAILED") {
      const message = result.errorMessage ?? `Failed to create Managed Volume: ${path}`
      if (/already\s*exist/i.test(message)) throw new FsError("FS_TARGET_EXISTS", message)
      throw new FsError("FS_TRANSFER_FAILED", message)
    }
    return true
  }
  async rb(path: string) {
    const volume = parseVolumePath(path)
    if (!volume || volume.reference.kind !== "named" || volume.reference.identifiers.length === 0 || volume.relativePath) {
      throw new FsError("FS_PATH_INVALID", `fs rb expects a Managed Volume root in the form czfs:/Volumes/<workspace>/<schema>/<volume>; received '${path}'.`)
    }
    const reference = qualifyNamedVolume(volume.reference, this.workspace, this.schema, path)
    const volumeName = reference.identifiers.at(-1)!
    const volumeSchema = reference.identifiers[1]
    const volumeWorkspace = reference.identifiers[0]
    const filters = [
      `volume_name = ${quote(volumeName)}`,
      ...(volumeSchema ? [`schema_name = ${quote(volumeSchema)}`] : []),
      ...(volumeWorkspace ? [`workspace_name = ${quote(volumeWorkspace)}`] : []),
    ]
    const volumes = await this.execute(`SHOW VOLUMES WHERE ${filters.join(" AND ")}`)
    if (volumes.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", volumes.errorMessage ?? "Failed to verify Volume type")
    if (volumes.rows.length === 0) throw new FsError("FS_NOT_FOUND", `Managed Volume was not found: ${path}`)
    const columnNames = new Set(volumes.columns.map((column) => column.name.toLowerCase()))
    const hasColumn = (...names: string[]) => names.some((name) => columnNames.has(name))
    if (!hasColumn("volume_name", "name") || !hasColumn("schema_name", "schema") || !hasColumn("workspace_name", "workspace")) {
      throw new FsError("FS_TRANSFER_FAILED", `SHOW VOLUMES returned incomplete identity metadata for '${path}'; refusing to drop it`)
    }
    const metadata = volumes.rows.find((row) => {
      const name = String(resultValue(volumes, row, "volume_name", "name") ?? "")
      const schema = String(resultValue(volumes, row, "schema_name", "schema") ?? "")
      const workspace = String(resultValue(volumes, row, "workspace_name", "workspace") ?? "")
      return name === volumeName && (!volumeSchema || schema === volumeSchema) && (!volumeWorkspace || workspace === volumeWorkspace)
    })
    if (!metadata) throw new FsError("FS_NOT_FOUND", `Managed Volume was not found: ${path}`)
    const external = resultValue(volumes, metadata, "external", "is_external", "volume_type", "type")
    if (external === undefined) {
      throw new FsError("FS_TRANSFER_FAILED", `SHOW VOLUMES did not return a volume type for '${path}'; refusing to drop it`)
    }
    const externalText = String(external).trim().toLowerCase()
    if (external === true || external === 1 || externalText === "true" || externalText === "external" || externalText === "external_volume" || externalText === "1") {
      throw new FsError("FS_PATH_INVALID", `fs rb only removes Managed Volumes; '${path}' is an External Volume`)
    }
    if (external !== false && externalText !== "false" && externalText !== "managed" && externalText !== "named" && externalText !== "managed_volume" && externalText !== "named_volume" && externalText !== "0") {
      throw new FsError("FS_TRANSFER_FAILED", `SHOW VOLUMES returned an unknown volume type for '${path}'; refusing to drop it`)
    }
    const entries = await listVolumeDirectory(reference, path, this.execute, false, 1)
    if (entries.length > 0) {
      throw new FsError("FS_NOT_EMPTY", `Managed Volume is not empty: ${path}. Remove its files explicitly before running fs rb.`)
    }
    const result = await this.execute(`drop volume ${volumeDefinitionIdentifier(reference)}`)
    if (result.status === "FAILED") {
      const message = result.errorMessage ?? `Failed to drop Managed Volume: ${path}`
      if (isMissingVolumePathError(message)) throw new FsError("FS_NOT_FOUND", message)
      throw new FsError("FS_TRANSFER_FAILED", message)
    }
    return true
  }
  async validateRemoval(path: string, recurse = false) {
    const target = this.path(path)
    if (target.isRoot) throw new FsError("FS_PATH_INVALID", `Cannot remove root path: ${path}`)
    const info = await target.info()
    if (info.isDir && !recurse) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory removal requires recursive flag: ${path}`)
    return info
  }
  async cp(source: string, destination: string, recurse = false, overwrite = false) {
    const progress: CopyProgress = { completed: [] }
    await this.copyBytes(source, destination, recurse, overwrite, progress)
    return true
  }
  async copyBytes(source: string, destination: string, recurse = false, overwrite = false, progress?: CopyProgress) {
    const from = this.path(source)
    let to = this.path(destination)
    if (pathIdentity(from) === pathIdentity(to)) throw new FsError("FS_PATH_INVALID", "Source and destination must be different")
    const destinationLooksLikeDirectory = destination.endsWith("/") || destination.endsWith("\\")
    const destinationExists = await to.exists()
    if (destinationLooksLikeDirectory && !destinationExists) throw new FsError("FS_NOT_FOUND", `Destination directory not found: ${destination}`)
    const sourceInfo = await from.info()
    if (destinationExists) {
      const targetInfo = await to.info()
      if (destinationLooksLikeDirectory && !targetInfo.isDir) throw new FsError("FS_IS_DIRECTORY", `Destination is not a directory: ${destination}`)
      if (targetInfo.isDir) to = to.child(sourceInfo.name)
      else if (sourceInfo.isDir) throw new FsError("FS_TARGET_EXISTS", `Target is a file: ${destination}`)
    }
    if (pathIdentity(from) === pathIdentity(to)) throw new FsError("FS_PATH_INVALID", "Source and destination must be different")
    if (sourceInfo.isDir && isDescendantPath(from, to)) throw new FsError("FS_PATH_INVALID", "Destination cannot be inside the source directory")
    if (sourceInfo.isDir) {
      const children = await from.children(recurse)
      const files: FsPath[] = []
      for (const child of children) if (!(await child.info()).isDir) files.push(child)
      const copyProgress = progress ?? { completed: [] }
      if (!overwrite) {
        for (const child of files) {
          const childTarget = to.child(relativeChildPath(source, child.original))
          if (await childTarget.exists()) throw new FsError("FS_TARGET_EXISTS", `Target already exists: ${childTarget.original}`)
        }
      }
      try { await to.mkdirs() }
      catch (error) {
        if (!progress) throw error
        throw new FsError("PARTIAL_FAILED", `Directory copy failed during COPY: ${source}`, {
          stage: "COPY",
          completed: copyProgress.completed,
          failed: { source, destination, error: error instanceof Error ? error.message : String(error) },
          pending: files.map((pending) => pending.original),
        })
      }
      let bytes = 0
      for (const child of files) {
        const childTarget = to.child(relativeChildPath(source, child.original))
        try {
          const copied = await child.copyTo(childTarget, false, overwrite)
          bytes += copied
          copyProgress.completed.push({ source: child.original, destination: childTarget.original, bytes: copied })
        } catch (error) {
          if (error instanceof FsError && error.code === "FS_TARGET_EXISTS") throw error
          if (!progress) throw error
          throw new FsError("PARTIAL_FAILED", `Directory copy failed during COPY: ${child.original}`, {
            stage: "COPY",
            completed: copyProgress.completed,
            failed: { source: child.original, destination: childTarget.original, error: error instanceof Error ? error.message : String(error) },
            pending: files.slice(files.indexOf(child) + 1).map((pending) => pending.original),
          })
        }
      }
      return bytes
    }
    try {
      const copied = await from.copyTo(to, false, overwrite)
      progress?.completed.push({ source: from.original, destination: to.original, bytes: copied })
      return copied
    } catch (error) {
      if (error instanceof FsError && error.code === "FS_TARGET_EXISTS") throw error
      if (!progress) throw error
      throw new FsError("PARTIAL_FAILED", `File copy failed during COPY: ${source}`, {
        stage: "COPY",
        completed: progress.completed,
        failed: { source, destination, error: error instanceof Error ? error.message : String(error) },
        pending: [],
      })
    }
  }
  async readBytes(file: string, maxBytes = 65536) {
    const path = this.path(file)
    if ((await path.info()).isDir) throw new FsError("FS_IS_DIRECTORY", `Path is a directory: ${file}`)
    return path.read(maxBytes)
  }
  async head(file: string, maxBytes = 65536) {
    const data = await this.readBytes(file, maxBytes)
    try { return new TextDecoder("utf-8", { fatal: true }).decode(data) }
    catch { throw new FsError("FS_NOT_TEXT", `File is not valid UTF-8 text: ${file}`) }
  }
  async ls(path: string, recurse = false, limit = 0) {
    const virtual = await this.listVirtualRoot(path, recurse, limit)
    if (virtual !== undefined) return virtual
    const items = await this.path(path).children(recurse, limit)
    const infos = await Promise.all(items.map(async (item) => {
      try { return await item.info() }
      catch (error) {
        // Ignore dangling symlinks and files removed during enumeration; one
        // unreadable entry must not make `fs ls /` fail as a whole.
        if (item.isLocal && error instanceof FsError && error.code === "FS_NOT_FOUND") return undefined
        throw error
      }
    }))
    return infos.filter((item): item is FileInfo => item !== undefined)
  }
  async mkdirs(path: string) { await this.path(path).mkdirs(); return true }
  async put(file: string, contents: string, overwrite = false) {
    const data = new TextEncoder().encode(contents)
    await this.path(file).write(data, overwrite, data.byteLength)
    return true
  }
  async mv(source: string, destination: string, recurse = false, overwrite = false) {
    const from = this.path(source)
    const to = this.path(destination)
    if (pathIdentity(from) === pathIdentity(to)) throw new FsError("FS_PATH_INVALID", "Source and destination must be different")
    const info = await from.info()
    if (info.isDir && !recurse) throw new FsError("FS_RECURSIVE_REQUIRED", `Directory move requires recursive flag: ${source}`)
    if (from.isLocal && to.isLocal) return this.moveLocal(from, to, info, recurse, overwrite)
    const progress: CopyProgress = { completed: [] }
    try { await this.copyBytes(source, destination, recurse, overwrite, progress) }
    catch (error) {
      if (error instanceof FsError && ["FS_PATH_INVALID", "FS_PATH_CONTEXT_REQUIRED", "FS_NOT_FOUND", "FS_RECURSIVE_REQUIRED", "FS_TARGET_EXISTS", "PARTIAL_FAILED"].includes(error.code)) throw error
      throw new FsError("PARTIAL_FAILED", `Move failed during COPY: ${source}`, {
        stage: "COPY",
        completed: progress.completed,
        failed: { source, destination, error: error instanceof Error ? error.message : String(error) },
        pending: [],
      })
    }
    try { await from.remove(recurse) }
    catch (error) {
      throw new FsError("PARTIAL_FAILED", `Move failed during REMOVE: ${source}`, {
        stage: "REMOVE",
        completed: progress.completed,
        failed: { source, destination, error: error instanceof Error ? error.message : String(error) },
        pending: [],
      })
    }
    return true
  }
  async rm(path: string, recurse = false) {
    await this.path(path).remove(recurse)
    return true
  }

  private async listVirtualRoot(path: string, recursive: boolean, limit: number): Promise<FileInfo[] | undefined> {
    const normalized = path.toLowerCase().replace(/\/+$/, "")
    const hasCzfsScheme = normalized.startsWith("czfs:")
    const czfsRoot = hasCzfsScheme ? normalized.slice(5).replace(/^\/volume(?=\/|$)/, "/volumes") : ""
    const partial = parseCzfsNamespacePath(path)
    if (partial) {
      if (partial.kind === "table") {
        if (partial.identifiers.length === 0) return this.listVolumeWorkspaceRoots("table", limit)
        if (partial.identifiers.length === 1) return this.listTableSchemaRoots(partial.identifiers[0]!, limit)
        return this.listTableVolumeRoots(limit, partial.identifiers[0], partial.identifiers[1])
      }
      if (partial.kind === "user") {
        if (partial.identifiers.length === 0) return this.listVolumeWorkspaceRoots("user", limit)
        return this.listCurrentUserVolumeFiles(recursive, limit, partial.identifiers[0])
      }
      return this.listNamedVolumeRoots(limit, partial.identifiers[0], partial.identifiers[1])
    }
    if (isVolumeNamespaceRoot(path)) {
      if (normalized === "volume:") return this.listNamedVolumeRoots(limit)
      if (normalized === "volume:table:") return this.listTableVolumeRoots(limit)
      if (hasCzfsScheme && czfsRoot === "/volumes/@table") return this.listTableVolumeRoots(limit)
      return this.listVolumeNamespaceRoots(limit)
    }
    // Route the legacy User Volume root through the same resolver as czfs:/Volumes/@user
    // so both spellings report identical czfs entry paths, matching how volume:table://
    // already normalizes to czfs output.
    if ((hasCzfsScheme && czfsRoot === "/volumes/@user") || normalized === "volume:user://~") {
      return this.listVolumeWorkspaceRoots("user", limit)
    }
    return undefined
  }

  private async listNamedVolumeRoots(limit: number, workspaceFilter?: string, schemaFilter?: string): Promise<FileInfo[]> {
    const result = await this.execute("SHOW VOLUMES")
    if (result.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", result.errorMessage ?? "Failed to list Volumes")
    const rows = result.rows.flatMap((row) => {
      const name = String(resultValue(result, row, "volume_name", "name") ?? row[0] ?? "")
      const workspace = String(resultValue(result, row, "workspace_name", "workspace") ?? this.workspace ?? "")
      const schema = String(resultValue(result, row, "schema_name", "schema") ?? this.schema ?? "")
      if (workspaceFilter && workspace !== workspaceFilter || schemaFilter && schema !== schemaFilter) return []
      if (!name || !workspace || !schema) return []
      const reference: VolumeReference = { kind: "named", identifiers: [workspace, schema, name], czfsBase: buildCzfsBase("named", [workspace, schema, name]) }
      return [volumeEntry(reference, "", { create_time: resultValue(result, row, "create_time", "created_at") }, true)]
    })
    return limit > 0 ? rows.slice(0, limit) : rows
  }

  private async listVolumeNamespaceRoots(limit: number): Promise<FileInfo[]> {
    // Put the virtual entry points first: they are the only documented way to reach
    // User and Table Volumes, so a workspace with more Volumes than --limit must not
    // truncate them away.
    const entryPoints: FileInfo[] = [
      { path: "czfs:/Volumes/@user", name: "@user", size: 0, modificationTime: null, isDir: true },
      { path: "czfs:/Volumes/@table", name: "@table", size: 0, modificationTime: null, isDir: true },
    ]
    const remaining = limit > 0 ? Math.max(limit - entryPoints.length, 0) : 0
    if (limit > 0 && remaining === 0) return entryPoints.slice(0, limit)
    return [...entryPoints, ...await this.listNamedVolumeRoots(remaining)]
  }

  private async listVolumeWorkspaceRoots(kind: "user" | "table", limit: number): Promise<FileInfo[]> {
    const result = await this.execute("SHOW WORKSPACES")
    if (result.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", result.errorMessage ?? "Failed to list workspaces")
    const marker = kind === "user" ? "@user" : "@table"
    const rows = result.rows.flatMap((row) => {
      const workspace = String(resultValue(result, row, "workspace_name", "name") ?? row[0] ?? "")
      if (!workspace) return []
      return [{ path: `czfs:/Volumes/${marker}/${encodeURIComponent(workspace)}`, name: workspace, size: 0, modificationTime: null, isDir: true }]
    })
    return limit > 0 ? rows.slice(0, limit) : rows
  }

  private async listTableSchemaRoots(workspace: string, limit: number): Promise<FileInfo[]> {
    const result = await this.execute(`SHOW SCHEMAS IN ${quoteIdentifier(workspace)}`)
    if (result.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", result.errorMessage ?? "Failed to list schemas")
    const rows = result.rows.flatMap((row) => {
      const schema = String(resultValue(result, row, "schema_name", "name") ?? row[0] ?? "")
      if (!schema) return []
      return [{ path: `czfs:/Volumes/@table/${encodeURIComponent(workspace)}/${encodeURIComponent(schema)}`, name: schema, size: 0, modificationTime: null, isDir: true }]
    })
    return limit > 0 ? rows.slice(0, limit) : rows
  }

  private async resolveUserVolumeReference(workspace = this.workspace): Promise<VolumeReference> {
    if (!workspace) throw new FsError("FS_PATH_CONTEXT_REQUIRED", "Workspace is required for User Volume root")
    const identity = await this.execute("SELECT current_user()")
    if (identity.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", identity.errorMessage ?? "Failed to resolve current user")
    const user = String(identity.rows[0]?.[0] ?? "").trim()
    if (!user) throw new FsError("FS_TRANSFER_FAILED", "SELECT current_user() returned no user; refusing to access User Volume")
    const identifiers = [workspace, user]
    return { kind: "user", identifiers, czfsBase: buildCzfsBase("user", identifiers) }
  }

  private async listCurrentUserVolumeFiles(recursive: boolean, limit: number, workspace?: string): Promise<FileInfo[]> {
    // Use the resolved [workspace, user] pair directly. Re-deriving it by slicing the
    // czfs URI dropped the user segment and left identifiers=[workspace].
    const reference = await this.resolveUserVolumeReference(workspace)
    const entries = await listVolumeDirectory(reference, reference.czfsBase ?? "czfs:/Volumes/@user", this.execute, recursive, limit)
    return Promise.all(entries.map((entry) => entry.info()))
  }

  private async listTableVolumeRoots(limit: number, workspace = this.workspace, schema = this.schema): Promise<FileInfo[]> {
    if (!workspace || !schema) throw new FsError("FS_PATH_CONTEXT_REQUIRED", "Workspace and schema are required for Table Volume root")
    const result = await this.execute(schema && schema !== this.schema ? `SHOW TABLES IN ${quoteIdentifier(schema)}` : "SHOW TABLES")
    if (result.status === "FAILED") throw new FsError("FS_TRANSFER_FAILED", result.errorMessage ?? "Failed to list tables")
    const rows = result.rows.flatMap((row) => {
      const name = String(resultValue(result, row, "table_name", "name") ?? row[1] ?? row[0] ?? "")
      if (!name) return []
      // Only a real table owns a Table Volume. SHOW TABLES also returns views,
      // materialized views, external and dynamic tables; listing those as Volume
      // roots would advertise paths that SHOW TABLE VOLUME DIRECTORY rejects.
      const record = resultRecord(result, row)
      if (["is_view", "is_materialized_view", "is_external", "is_dynamic"].some((flag) => record[flag] === true)) return []
      if (record.schema_name !== undefined && String(record.schema_name) !== schema) return []
      const identifiers = [workspace, schema, name]
      const reference: VolumeReference = { kind: "table", identifiers, czfsBase: buildCzfsBase("table", identifiers) }
      return [volumeEntry(reference, "", {}, true)]
    })
    return limit > 0 ? rows.slice(0, limit) : rows
  }

  private async moveLocal(from: FsPath, to: FsPath, info: FileInfo, recurse: boolean, overwrite: boolean) {
    const destinationLooksLikeDirectory = to.original.endsWith("/") || to.original.endsWith("\\")
    const destinationExists = await to.exists()
    if (destinationLooksLikeDirectory && !destinationExists) throw new FsError("FS_NOT_FOUND", `Destination directory not found: ${to.original}`)
    const destinationInfo = destinationExists ? await to.info() : undefined
    if (destinationLooksLikeDirectory && destinationInfo && !destinationInfo.isDir) throw new FsError("FS_IS_DIRECTORY", `Destination is not a directory: ${to.original}`)
    let target = to
    if (destinationInfo?.isDir) target = to.child(info.name)
    const targetExists = await target.exists()
    const targetInfo = targetExists ? await target.info() : undefined
    if (info.isDir && targetInfo?.isDir) {
      const progress: CopyProgress = { completed: [] }
      try {
        await this.copyBytes(from.original, (destinationInfo?.isDir ? to : target).original, recurse, overwrite, progress)
      } catch (error) {
        if (error instanceof FsError && error.code === "FS_TARGET_EXISTS") throw error
        throw new FsError("PARTIAL_FAILED", `Move failed during COPY: ${from.original}`, {
          stage: "COPY",
          completed: progress.completed,
          failed: { source: from.original, destination: target.original, error: error instanceof Error ? error.message : String(error) },
          pending: [],
        })
      }
      try {
        await from.remove(recurse)
      } catch (error) {
        throw new FsError("PARTIAL_FAILED", `Move failed during REMOVE: ${from.original}`, {
          stage: "REMOVE",
          completed: progress.completed,
          failed: { source: from.original, destination: target.original, error: error instanceof Error ? error.message : String(error) },
          pending: [],
        })
      }
      return true
    }
    if (!overwrite && targetExists) throw new FsError("FS_TARGET_EXISTS", `Target already exists: ${target.original}`)
    const temporary = this.path(`${target.scopePath}.cz-tmp-${randomUUID()}`)
    const backup = this.path(`${target.scopePath}.cz-backup-${randomUUID()}`)
    let backupMoved = false
    try {
      await this.copyBytes(from.original, temporary.original, recurse, true)
      if (targetExists) {
        await rename(target.scopePath, backup.scopePath).catch((error) => { throw mapLocalError(error, target.original) })
        backupMoved = true
      }
      try {
        await rename(temporary.scopePath, target.scopePath)
      } catch (error) {
        if (backupMoved) {
          await rename(backup.scopePath, target.scopePath).catch(() => undefined)
          backupMoved = false
        }
        throw mapLocalError(error, target.original)
      }
      try {
        await from.remove(recurse)
      } catch (error) {
        const message = backupMoved
          ? `Move failed during REMOVE: ${from.original}. The previous target was preserved at ${backup.original}.`
          : `Move failed during REMOVE: ${from.original}`
        throw new FsError("PARTIAL_FAILED", message, {
          stage: "REMOVE",
          completed: [],
          failed: { source: from.original, destination: target.original, error: error instanceof Error ? error.message : String(error) },
          pending: [],
          ...(backupMoved ? { recovery: { backup: backup.original, source: from.original, destination: target.original } } : {}),
        })
      }
      if (backupMoved) await removeFile(backup.scopePath, { recursive: true, force: true })
      return true
    } catch (error) {
      await removeFile(temporary.scopePath, { recursive: true, force: true }).catch(() => undefined)
      // Preserve the backup on any failed move so a caller can recover the
      // original target even when the process or cleanup path fails.
      throw error
    }
  }
}

function pathIdentity(path: FsPath): string {
  return path.identity
}

function isDescendantPath(source: FsPath, target: FsPath): boolean {
  return source.scope === target.scope && source.scopePath !== "" && target.scopePath.startsWith(source.scopePath + "/")
}

function relativeChildPath(source: string, child: string): string {
  const sourceVolume = parseVolumePath(source)
  const childVolume = parseVolumePath(child)
  if (sourceVolume && childVolume) {
    const sourceRelative = sourceVolume.relativePath.replace(/\/+$/, "")
    const childRelative = childVolume.relativePath.replace(/\/+$/, "")
    const prefix = sourceRelative ? sourceRelative + "/" : ""
    return childRelative.startsWith(prefix) ? childRelative.slice(prefix.length) : basename(childRelative)
  }
  return relative(parseLocalPath(source), parseLocalPath(child)).split(sep).join("/")
}

export function createFsUtil(options: FsUtilOptions): FsUtil { return new FsUtil(options) }

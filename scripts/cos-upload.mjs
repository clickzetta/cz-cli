#!/usr/bin/env node
/**
 * Tencent COS upload helpers used by cos-release.mjs / cos-promote.mjs.
 *
 * Env vars (required when used as a module via `createClient()`):
 *   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *   COS_ACCELERATE — "true" (default) uses global acceleration endpoint,
 *                     "false" uses standard regional endpoint.
 *
 * CLI usage (one-off uploads):
 *   node scripts/cos-upload.mjs <local_path> <cos_key> [content-type]
 */

import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import COS from "cos-nodejs-sdk-v5"

const CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
const CACHE_SHORT = "public, max-age=300"
const CACHE_BOOTSTRAP = "public, max-age=60"

export const Cache = {
  immutable: CACHE_IMMUTABLE,
  short: CACHE_SHORT,
  bootstrap: CACHE_BOOTSTRAP,
}

export function createClient() {
  const SecretId = required("COS_SECRET_ID")
  const SecretKey = required("COS_SECRET_KEY")
  const Bucket = required("COS_BUCKET")
  const Region = required("COS_REGION")
  const accelerate = (process.env.COS_ACCELERATE ?? "true") !== "false"
  const client = new COS({
    SecretId,
    SecretKey,
    FileParallelLimit: 10,
    ChunkParallelLimit: 8,
    ...(accelerate ? { UseAccelerate: true } : {}),
  })
  return { client, Bucket, Region, accelerate }
}

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256")
    const stream = fs.createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("end", () => resolve(hash.digest("hex")))
    stream.on("error", reject)
  })
}

export async function statFileWithSha256(filePath, size = undefined, sha256 = undefined) {
  return {
    size: size ?? fs.statSync(filePath).size,
    sha256: sha256 ?? (await sha256OfFile(filePath)),
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms / 1000)}s`
}

function formatError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function createUploadProgressReporter({
  archiveName,
  filePath,
  key,
  size,
  sha256,
  log = console.log,
  now = Date.now,
  percentStep = 10,
  heartbeatMs = 15000,
}) {
  const startedAt = now()
  let lastBucket = -1
  let lastLoggedAt = startedAt
  return {
    start() {
      log(
        `  → upload start: ${archiveName} | size=${formatBytes(size)} | sha256=${sha256.slice(0, 12)} | file=${filePath} | key=${key}`,
      )
    },
    taskReady(taskId) {
      log(`    task ready: ${archiveName} | id=${taskId}`)
    },
    progress(info) {
      if (!info) return
      const total = info.total || size
      const loaded = Math.min(info.loaded || 0, total)
      const percent = Math.min(1, info.percent ?? (total > 0 ? loaded / total : 0))
      const bucket = Math.floor((percent * 100) / percentStep) * percentStep
      const current = now()
      if (bucket <= lastBucket && current - lastLoggedAt < heartbeatMs && percent < 1) return
      lastBucket = Math.max(lastBucket, bucket)
      lastLoggedAt = current
      log(
        `    progress: ${archiveName} | ${Math.round(percent * 100)}% | ${formatBytes(loaded)} / ${formatBytes(total)} | speed=${formatBytes(Math.round(info.speed || 0))}/s`,
      )
    },
    complete() {
      log(`  ✓ upload complete: ${archiveName} | elapsed=${formatDuration(now() - startedAt)} | key=${key}`)
    },
    fail(error) {
      log(
        `  ✗ upload failed: ${archiveName} | elapsed=${formatDuration(now() - startedAt)} | key=${key} | error=${formatError(error)}`,
      )
    },
  }
}

export async function withRetry(fn, { retries = 3, delayMs = 5000, log = console.log } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= retries) throw error
      log(`  ⚠ attempt ${attempt}/${retries} failed: ${formatError(error)} — retrying in ${delayMs / 1000}s...`)
      await new Promise((r) => setTimeout(r, delayMs * attempt))
    }
  }
}

export function publicUrl({ Bucket, Region, key, accelerate = false }) {
  if (accelerate) return `https://${Bucket}.cos.accelerate.myqcloud.com/${key}`
  return `https://${Bucket}.cos.${Region}.myqcloud.com/${key}`
}

export function presignGetObjectUrl({
  client,
  Bucket,
  Region,
  key,
  expiresIn,
  now = Date.now,
}) {
  const url = client.getObjectUrl({
    Bucket,
    Region,
    Key: key,
    Sign: true,
    Expires: expiresIn,
    Method: "GET",
    Protocol: "https:",
  })
  return {
    key,
    url,
    expiresIn,
    expiresAt: new Date(now() + expiresIn * 1000).toISOString(),
  }
}

export async function uploadFile({
  client,
  Bucket,
  Region,
  filePath,
  key,
  contentType,
  cacheControl,
  acl = "public-read",
  size: inputSize = undefined,
  sha256: inputSha256 = undefined,
  log = console.log,
  now = Date.now,
}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`uploadFile: ${filePath} does not exist`)
  }
  const { size, sha256 } = await statFileWithSha256(filePath, inputSize, inputSha256)
  const reporter = createUploadProgressReporter({
    archiveName: path.basename(filePath),
    filePath,
    key,
    size,
    sha256,
    log,
    now,
  })

  reporter.start()
  try {
    await new Promise((resolve, reject) => {
      client.sliceUploadFile(
        {
          Bucket,
          Region,
          Key: key,
          FilePath: filePath,
          SliceSize: 1024 * 1024 * 5,
          AsyncLimit: 8,
          Headers: {
            "x-cos-acl": acl,
            ...(contentType ? { "Content-Type": contentType } : {}),
            ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
          },
          ProgressInterval: 1000,
          onTaskReady: (taskId) => reporter.taskReady(taskId),
          onProgress: (info) => reporter.progress(info),
        },
        (err, data) => (err ? reject(err) : resolve(data)),
      )
    })
    reporter.complete()
  } catch (error) {
    reporter.fail(error)
    throw error
  }

  return {
    key,
    url: publicUrl({ Bucket, Region, key }),
    size,
    sha256,
  }
}

export async function uploadBuffer({
  client,
  Bucket,
  Region,
  body,
  key,
  contentType,
  cacheControl,
  acl = "public-read",
}) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
  const sha256 = createHash("sha256").update(buffer).digest("hex")

  await new Promise((resolve, reject) => {
    client.putObject(
      {
        Bucket,
        Region,
        Key: key,
        Body: buffer,
        Headers: {
          "x-cos-acl": acl,
          ...(contentType ? { "Content-Type": contentType } : {}),
          ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
        },
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    )
  })

  return {
    key,
    url: publicUrl({ Bucket, Region, key }),
    size: buffer.length,
    sha256,
  }
}

export async function putText(args) {
  return uploadBuffer({
    ...args,
    body: args.body,
    contentType: args.contentType ?? "text/plain; charset=utf-8",
  })
}

export async function putJson(args) {
  return uploadBuffer({
    ...args,
    body: JSON.stringify(args.body, null, 2),
    contentType: args.contentType ?? "application/json; charset=utf-8",
  })
}

export async function getText({ client, Bucket, Region, key }) {
  return new Promise((resolve, reject) => {
    client.getObject({ Bucket, Region, Key: key }, (err, data) => {
      if (err) {
        if (err.statusCode === 404) return resolve(null)
        return reject(err)
      }
      resolve(data.Body.toString("utf8"))
    })
  })
}

export async function getJson(args) {
  const text = await getText(args)
  if (text == null) return null
  return JSON.parse(text)
}

export async function listPrefix({ client, Bucket, Region, prefix }) {
  const all = []
  let marker = undefined
  while (true) {
    const data = await new Promise((resolve, reject) => {
      client.getBucket(
        { Bucket, Region, Prefix: prefix, Marker: marker, MaxKeys: 1000 },
        (err, res) => (err ? reject(err) : resolve(res)),
      )
    })
    for (const obj of data.Contents ?? []) all.push(obj.Key)
    if (data.IsTruncated === "true" || data.IsTruncated === true) {
      marker = data.NextMarker ?? all[all.length - 1]
    } else {
      break
    }
  }
  return all
}

export async function deleteObjects({ client, Bucket, Region, keys }) {
  if (keys.length === 0) return
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000)
    await new Promise((resolve, reject) => {
      client.deleteMultipleObject(
        {
          Bucket,
          Region,
          Objects: batch.map((Key) => ({ Key })),
        },
        (err, res) => (err ? reject(err) : resolve(res)),
      )
    })
  }
}

if (import.meta.url === `file://${fileURLToPath(import.meta.url)}` && process.argv[1]?.endsWith("cos-upload.mjs")) {
  const [, , filePath, key, contentType] = process.argv
  if (!filePath || !key) {
    console.error("Usage: cos-upload.mjs <local_path> <cos_key> [content-type]")
    process.exit(1)
  }
  const { client, Bucket, Region } = createClient()
  const result = await uploadFile({
    client,
    Bucket,
    Region,
    filePath: path.resolve(filePath),
    key,
    contentType,
    cacheControl: CACHE_IMMUTABLE,
  })
  console.log(JSON.stringify(result, null, 2))
}

#!/usr/bin/env node
/**
 * Tencent COS upload helpers used by cos-release.mjs / cos-promote.mjs.
 *
 * Env vars (required when used as a module via `createClient()`):
 *   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
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
  const client = new COS({ SecretId, SecretKey })
  return { client, Bucket, Region }
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

function publicUrl({ Bucket, Region, key }) {
  return `https://${Bucket}.cos.${Region}.myqcloud.com/${key}`
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
}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`uploadFile: ${filePath} does not exist`)
  }
  const size = fs.statSync(filePath).size
  const sha256 = await sha256OfFile(filePath)

  await new Promise((resolve, reject) => {
    client.sliceUploadFile(
      {
        Bucket,
        Region,
        Key: key,
        FilePath: filePath,
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

#!/usr/bin/env node
/**
 * Bundle dist artifacts and publish a release to Tencent COS.
 *
 * Usage:
 *   bun run scripts/cos-release.mjs \
 *     --version 0.3.62 \
 *     --dist packages/opencode/dist \
 *     --git-sha $GITHUB_SHA \
 *     --build-date 2026-05-27T10:00:00Z \
 *     [--no-promote-nightly] [--promote-stable] [--retain 10] [--dry-run]
 *
 * Env: COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
 *      COS_PATH_PREFIX (optional, default "cz-cli-releases")
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  Cache,
  createClient,
  presignGetObjectUrl,
  formatBytes,
  deleteObjects,
  getJson,
  listPrefix,
  putJson,
  putText,
  statFileWithSha256,
  uploadFile,
  withRetry,
} from "./cos-upload.mjs"

const PATH_PREFIX = process.env.COS_PATH_PREFIX ?? "cz-cli-releases"
const META_INF_PREFIX = "META-INF"
const PRESIGN_EXPIRES_SECONDS = Number(process.env.COS_PRESIGN_EXPIRES_SECONDS ?? 60 * 60 * 24 * 365 * 5)

const VERSION_RE = /^(?:\d+\.\d+\.\d+([-+][\w.-]+)?|dev-v\d+\.\d+\.\d+\.[\w.-]+)$/
const VERSION_DIR_RE = /^(?:\d+\.\d+\.\d+([-+][\w.-]+)?|dev-v\d+\.\d+\.\d+\.[\w.-]+)\/$/

/** Compare release versions. Returns <0 if a<b, 0 if equal, >0 if a>b. */
export function compareReleaseVersions(a, b) {
  const pa = a.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  const pb = b.replace(/^dev-v/, "").replace(/[-+].*$/, "").split(".")
  for (let i = 0; i < 3; i++) {
    const left = Number(pa[i] ?? 0)
    const right = Number(pb[i] ?? 0)
    if (left !== right) return left - right
  }
  if (a.startsWith("dev-v") && b.startsWith("dev-v")) return pa.slice(3).join(".").localeCompare(pb.slice(3).join("."))
  return 0
}

const DIST_PREFIX = "cz-cli-"

// dist subdir name → COS platform name
function distToPlatform(distName) {
  if (!distName.startsWith(DIST_PREFIX)) return null
  return distName.slice(DIST_PREFIX.length).replace(/^windows-/, "win32-")
}

function platformBinary(platform) {
  return platform.startsWith("win32") ? "cz-cli.exe" : "cz-cli"
}

function platformArchiveExt(platform) {
  if (platform.startsWith("linux")) return "tar.gz"
  return "zip"
}

function archiveName(version, platform) {
  return `cz-cli-${version}-${platform}.${platformArchiveExt(platform)}`
}

function parseArgs(argv) {
  const args = {
    version: undefined,
    dist: undefined,
    gitSha: undefined,
    buildDate: undefined,
    promoteNightly: true,
    promoteStable: false,
    retain: 10,
    dryRun: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const next = () => argv[++i]
    switch (flag) {
      case "--version":
        args.version = next()
        break
      case "--dist":
        args.dist = next()
        break
      case "--git-sha":
        args.gitSha = next()
        break
      case "--build-date":
        args.buildDate = next()
        break
      case "--retain":
        args.retain = Number(next())
        break
      case "--promote-nightly":
        args.promoteNightly = true
        break
      case "--no-promote-nightly":
        args.promoteNightly = false
        break
      case "--promote-stable":
        args.promoteStable = true
        break
      case "--dry-run":
        args.dryRun = true
        break
      default:
        throw new Error(`Unknown flag: ${flag}`)
    }
  }
  return args
}

function validateArgs(args) {
  if (!args.version) throw new Error("--version is required")
  if (!VERSION_RE.test(args.version)) {
    throw new Error(`Invalid version: ${args.version}`)
  }
  if (!args.dist) throw new Error("--dist is required")
  if (!fs.existsSync(args.dist)) throw new Error(`dist not found: ${args.dist}`)
  if (!args.gitSha) args.gitSha = "unknown"
  if (!args.buildDate) args.buildDate = new Date().toISOString()
  if (!Number.isInteger(args.retain) || args.retain < 1) {
    throw new Error("--retain must be a positive integer")
  }
}

function detectPlatforms(distDir) {
  const subdirs = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(DIST_PREFIX))
    .map((d) => d.name)
  return subdirs
    .map((name) => {
      const platform = distToPlatform(name)
      if (!platform) return null
      return { distName: name, platform, distPath: path.join(distDir, name) }
    })
    .filter(Boolean)
}

function ensureBinary(distPath, platform) {
  const binary = platformBinary(platform)
  const binaryPath = path.join(distPath, "bin", binary)
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Missing binary: ${binaryPath}`)
  }
  return binaryPath
}

async function archivePlatform({ distPath, platform, version, archivesDir }) {
  const ext = platformArchiveExt(platform)
  const name = archiveName(version, platform)
  const archivePath = path.join(archivesDir, name)
  const binDir = path.join(distPath, "bin")

  ensureBinary(distPath, platform)
  fs.mkdirSync(archivesDir, { recursive: true })

  if (ext === "tar.gz") {
    execFileSync("tar", ["-czf", path.resolve(archivePath), "."], {
      cwd: binDir,
      stdio: "inherit",
    })
  } else {
    if (fs.existsSync(archivePath)) fs.rmSync(archivePath)
    execFileSync("zip", ["-rq", path.resolve(archivePath), "."], {
      cwd: binDir,
      stdio: "inherit",
    })
  }

  return { archivePath, archiveName: name, format: ext, ...(await statFileWithSha256(archivePath)) }
}

function key(...parts) {
  return [PATH_PREFIX, ...parts].join("/")
}

function metaRootKey(...parts) {
  return key(META_INF_PREFIX, ...parts)
}

function metaKey(channel, ...parts) {
  return metaRootKey("channels", channel, ...parts)
}

function releaseMetaKey(version, ...parts) {
  return metaRootKey("releases", version, ...parts)
}

function requestedChannels(ctx) {
  const channels = []
  if (ctx.promoteNightly) channels.push("nightly")
  if (ctx.promoteStable) channels.push("stable")
  return channels
}

function defaultManifestChannel(version, channels) {
  if (channels.includes("stable")) return "stable"
  if (channels.includes("nightly")) return "nightly"
  return version.startsWith("dev-v") ? "nightly" : "stable"
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

export async function uploadAllArchives(ctx, builds, options = {}) {
  const log = options.log ?? console.log
  const uploadFn = options.uploadFn ?? uploadFile
  const platforms = {}
  if (ctx.dryRun) {
    for (const b of builds) {
      log(`[dry-run] upload ${b.archivePath} -> ${b.targetKey}`)
      platforms[b.platform] = {
        archive: b.archiveName,
        format: b.format,
        binary: platformBinary(b.platform),
        checksum: b.sha256,
        size: b.size,
      }
    }
    return platforms
  }

  const results = await Promise.all(
    builds.map(async (b) => {
      log(`uploading ${b.platform}: ${b.archiveName} -> ${b.targetKey}`)
      const logFn = (msg) => log(`[${b.platform}] ${msg}`)
      const result = await withRetry(
        () =>
          uploadFn({
            client: ctx.client,
            Bucket: ctx.Bucket,
            Region: ctx.Region,
            filePath: b.archivePath,
            key: b.targetKey,
            contentType: "application/octet-stream",
            cacheControl: Cache.immutable,
            acl: "private",
            size: b.size,
            sha256: b.sha256,
            log: logFn,
          }),
        { retries: 3, delayMs: 10000, log: logFn },
      )
      return { platform: b.platform, archiveName: b.archiveName, result }
    }),
  )

  for (const r of results) {
    log(`  ✓ ${r.platform} (${(r.result.size / 1024 / 1024).toFixed(1)} MB)`)
    platforms[r.platform] = {
      archive: r.archiveName,
      format: r.result.format ?? platformArchiveExt(r.platform),
      binary: platformBinary(r.platform),
      checksum: r.result.sha256,
      size: r.result.size,
    }
  }
  return platforms
}

function logPreparedArchives(builds) {
  console.log("Prepared archives:")
  for (const build of builds) {
    console.log(
      `  - platform=${build.platform} archive=${build.archiveName} size=${formatBytes(build.size)} sha256=${build.sha256.slice(0, 12)} path=${build.archivePath} target=${build.targetKey}`,
    )
  }
}

function signReleaseObjectUrl(ctx, targetKey) {
  if (ctx.dryRun) {
    return {
      objectKey: targetKey,
      url: `https://example.invalid/${targetKey}?sign=dry-run`,
      expiresAt: new Date(Date.parse(ctx.buildDate) + PRESIGN_EXPIRES_SECONDS * 1000).toISOString(),
    }
  }
  const presigned = presignGetObjectUrl({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    key: targetKey,
    expiresIn: PRESIGN_EXPIRES_SECONDS,
  })
  return {
    objectKey: targetKey,
    url: presigned.url,
    expiresAt: presigned.expiresAt,
  }
}

function signArchiveUrls(ctx, builds, platforms) {
  return Object.fromEntries(
    builds.map((build) => {
      const presigned = signReleaseObjectUrl(ctx, build.targetKey)
      return [
        build.platform,
        {
          ...platforms[build.platform],
          objectKey: presigned.objectKey,
          url: presigned.url,
          expiresAt: presigned.expiresAt,
        },
      ]
    }),
  )
}

function buildManifest(ctx, platforms, channel) {
  return {
    version: ctx.version,
    channel,
    commit: ctx.gitSha,
    buildDate: ctx.buildDate,
    generatedAt: new Date().toISOString(),
    bootstrap: {
      sh: releaseMetaKey(ctx.version, "bootstrap.sh"),
      ps1: releaseMetaKey(ctx.version, "bootstrap.ps1"),
      manifest: releaseMetaKey(ctx.version, "manifest.json"),
    },
    platforms,
  }
}

function renderShellPlatformCase(platforms) {
  return Object.entries(platforms)
    .map(
      ([platform, info]) => `    "${platform}")
      ARCHIVE_URL=${shellQuote(info.url)}
      ARCHIVE_NAME=${shellQuote(info.archive)}
      ARCHIVE_FORMAT=${shellQuote(info.format)}
      ARCHIVE_CHECKSUM=${shellQuote(info.checksum)}
      ;;`,
    )
    .join("\n")
}

export function renderBootstrapSh({ version, channel, platforms }) {
  return `#!/bin/sh
set -e

VERSION="${version}"
CHANNEL="${channel}"
INSTALL_DIR="\${INSTALL_DIR:-\${HOME}/.local/bin}"
TEMP_DIR=$(mktemp -d)

cleanup() {
  [ -d "$TEMP_DIR" ] && rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

print_error() {
  echo "Error: $1" >&2
}

download() {
  if command -v curl > /dev/null 2>&1; then
    curl -fL --progress-bar "$1" -o "$2"
    return
  fi
  if command -v wget > /dev/null 2>&1; then
    wget -O "$2" "$1"
    return
  fi
  print_error "curl or wget is required"
  exit 1
}

verify_checksum() {
  if command -v shasum > /dev/null 2>&1; then
    ACTUAL=$(shasum -a 256 "$1" | awk '{print $1}')
  elif command -v sha256sum > /dev/null 2>&1; then
    ACTUAL=$(sha256sum "$1" | awk '{print $1}')
  else
    echo "Warning: no SHA256 verifier found, skipping checksum verification"
    return
  fi

  if [ "$ACTUAL" != "$2" ]; then
    print_error "checksum mismatch for $1"
    exit 1
  fi
}

check_version() {
  EXISTING_PATH=$(command -v cz-cli 2>/dev/null || true)
  if [ -z "$EXISTING_PATH" ]; then
    return
  fi

  INSTALLED_VERSION=$("$EXISTING_PATH" --version 2>/dev/null || echo "")
  if [ -z "$INSTALLED_VERSION" ]; then
    print_error "PATH contains a cz-cli entry that cannot run --version: $EXISTING_PATH"
    print_error "Remove this stale entry from PATH or delete the broken file, then run the installer again."
    exit 1
  fi
  if [ "$INSTALLED_VERSION" = "$VERSION" ]; then
    echo "Version $VERSION already installed"
    exit 0
  fi
}

platform() {
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m | tr '[:upper:]' '[:lower:]')

  case "$ARCH" in
    x86_64|amd64) ARCH="x64" ;;
    aarch64|arm64) ARCH="arm64" ;;
  esac

  echo "$OS-$ARCH"
}

main() {
  PLATFORM=$(platform)
  check_version

  case "$PLATFORM" in
${renderShellPlatformCase(platforms)}
    *)
      print_error "unsupported platform: $PLATFORM"
      exit 1
      ;;
  esac

  case "$ARCHIVE_FORMAT" in
    tar.gz)
      command -v tar > /dev/null 2>&1 || {
        print_error "tar is required"
        exit 1
      }
      ;;
    zip)
      command -v unzip > /dev/null 2>&1 || {
        print_error "unzip is required"
        exit 1
      }
      ;;
  esac

  ARCHIVE_PATH="$TEMP_DIR/$ARCHIVE_NAME"
  EXTRACT_DIR="$TEMP_DIR/extracted"
  mkdir -p "$EXTRACT_DIR"

  echo "Installing cz-cli v$VERSION for $PLATFORM ($CHANNEL)"
  echo "Downloading $ARCHIVE_NAME..."
  download "$ARCHIVE_URL" "$ARCHIVE_PATH"
  verify_checksum "$ARCHIVE_PATH" "$ARCHIVE_CHECKSUM"

  echo "Extracting..."
  case "$ARCHIVE_FORMAT" in
    tar.gz) tar -xzf "$ARCHIVE_PATH" -C "$EXTRACT_DIR" ;;
    zip) unzip -qo "$ARCHIVE_PATH" -d "$EXTRACT_DIR" ;;
  esac

  if [ ! -f "$EXTRACT_DIR/setup.sh" ]; then
    print_error "archive does not contain setup.sh"
    exit 1
  fi

  chmod +x "$EXTRACT_DIR/setup.sh"
  INSTALL_DIR="$INSTALL_DIR" \
  CZ_VERSION="$VERSION" \
  CZ_CHANNEL="$CHANNEL" \
  NON_INTERACTIVE="\${NON_INTERACTIVE:-}" \
  SKIP_PATH_PROMPT="\${SKIP_PATH_PROMPT:-}" \
  sh "$EXTRACT_DIR/setup.sh"
}

main
`
}

function renderPowerShellPlatformCase(platforms) {
  return Object.entries(platforms)
    .map(
      ([platform, info]) => `  ${psQuote(platform)} {
    $ArchiveUrl = ${psQuote(info.url)}
    $ArchiveName = ${psQuote(info.archive)}
    $ArchiveChecksum = ${psQuote(info.checksum)}
  }`,
    )
    .join("\n")
}

export function renderBootstrapPs1({ version, channel, platforms }) {
  return `#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"
$Version = '${version}'
$Channel = '${channel}'
$InstallDir = if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path (Join-Path $HOME ".local") "bin" }
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("cz-cli-" + [System.Guid]::NewGuid().ToString("n"))

New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

function Normalize-PathEntry($PathEntry) {
  if ([string]::IsNullOrWhiteSpace($PathEntry)) { return "" }
  return $PathEntry.Trim().TrimEnd("\\", "/").ToLowerInvariant()
}

function Test-PathEntry($PathValue, $Entry) {
  $NormalizedEntry = Normalize-PathEntry $Entry
  if ([string]::IsNullOrEmpty($NormalizedEntry)) { return $false }
  foreach ($Item in ($PathValue -split ";")) {
    if ((Normalize-PathEntry $Item) -eq $NormalizedEntry) { return $true }
  }
  return $false
}

function Resolve-InstallDir($InstallDir) {
  return [System.IO.Path]::GetFullPath($InstallDir)
}

function Add-InstallDirToPath($InstallDir) {
  $InstallDir = Resolve-InstallDir $InstallDir
  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Test-PathEntry $UserPath $InstallDir)) {
    $NewUserPath = if ([string]::IsNullOrEmpty($UserPath)) { $InstallDir } else { "$UserPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("Path", $NewUserPath, [EnvironmentVariableTarget]::User)
  }
  if (-not (Test-PathEntry $env:Path $InstallDir)) {
    $env:Path = if ([string]::IsNullOrEmpty($env:Path)) { $InstallDir } else { "$env:Path;$InstallDir" }
  }
}

function Repair-InstallDirPath($InstallDir) {
  try {
    Add-InstallDirToPath $InstallDir
    Write-Host "Current shell PATH updated. You can run: cz-cli --version"
  } catch {
    Write-Host "Could not add $InstallDir to User PATH automatically." -ForegroundColor Yellow
    Write-Host "Run this PowerShell command manually:"
    Write-Host "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$InstallDir', [EnvironmentVariableTarget]::User)"
  }
}

function Copy-BundledSkills($SkillsSource) {
  $BuiltinDest = Join-Path (Join-Path (Join-Path $HOME ".clickzetta") "skills") ".builtin"
  Remove-Item -LiteralPath $BuiltinDest -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $BuiltinDest | Out-Null

  if (Test-Path -LiteralPath $SkillsSource) {
    Get-ChildItem -LiteralPath $SkillsSource -Directory | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $BuiltinDest $_.Name) -Recurse -Force
    }
  }
}

function Install-ExternalAgentSkill($SkillsSource) {
  $ExternalSkillSource = Join-Path $SkillsSource "cz-cli"
  $AgentDirs = @(
    @(".claude", "skills"),
    @(".kiro", "skills"),
    @(".cursor", "skills"),
    @(".codex", "skills"),
    @(".openclaw", "workspace", "skills"),
    @(".singclaw", "workspace", "skills")
  )
  $LegacySkills = @("czagent", "czcli", "cz-cli-v2")

  foreach ($Segments in $AgentDirs) {
    try {
      $AgentDir = $HOME
      foreach ($Segment in $Segments) {
        $AgentDir = Join-Path $AgentDir $Segment
      }

      foreach ($Legacy in $LegacySkills) {
        Remove-Item -LiteralPath (Join-Path $AgentDir $Legacy) -Recurse -Force -ErrorAction SilentlyContinue
      }

      if (Test-Path -LiteralPath $ExternalSkillSource) {
        New-Item -ItemType Directory -Force -Path $AgentDir | Out-Null
        $Target = Join-Path $AgentDir "cz-cli"
        Remove-Item -LiteralPath $Target -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Item -LiteralPath $ExternalSkillSource -Destination $Target -Recurse -Force
      }
    } catch {}
  }
}

$InstallDir = Resolve-InstallDir $InstallDir

try {
  $BinaryTarget = Join-Path $InstallDir "cz-cli.exe"
  if (Test-Path -LiteralPath $BinaryTarget) {
    $InstalledTargetVersion = (& $BinaryTarget --version 2>$null).Trim()
    if ($InstalledTargetVersion -eq $Version) {
      Repair-InstallDirPath $InstallDir
      Write-Host "Version $Version is present; refreshing installation files"
    }
  }

  $InstalledCommand = Get-Command cz-cli -ErrorAction SilentlyContinue
  if ($InstalledCommand) {
    $InstalledVersion = (& cz-cli --version 2>$null).Trim()
    if ($InstalledVersion -eq $Version) {
      Repair-InstallDirPath $InstallDir
      Write-Host "Version $Version is present; refreshing installation files"
    }
  }

  $Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    default { $env:PROCESSOR_ARCHITECTURE.ToLowerInvariant() }
  }
  $Platform = "win32-$Arch"

  switch ($Platform) {
${renderPowerShellPlatformCase(platforms)}
    default { throw "unsupported platform: $Platform" }
  }

  Write-Host "Installing cz-cli v$Version for $Platform ($Channel)"
  $ArchivePath = Join-Path $TempDir $ArchiveName
  $ExtractDir = Join-Path $TempDir "extracted"

  Write-Host "Downloading $ArchiveName..."
  Invoke-WebRequest -Uri $ArchiveUrl -OutFile $ArchivePath

  $ActualChecksum = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($ActualChecksum -ne $ArchiveChecksum.ToLowerInvariant()) {
    throw "checksum mismatch for $ArchiveName"
  }

  Write-Host "Extracting..."
  Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractDir -Force

  $BinarySource = Join-Path $ExtractDir "cz-cli.exe"
  if (-not (Test-Path $BinarySource)) {
    throw "archive does not contain cz-cli.exe"
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -LiteralPath $BinarySource -Destination $BinaryTarget -Force
  $AgentTarget = Join-Path $InstallDir "cz-agent.cmd"
  Set-Content -LiteralPath $AgentTarget -Value @(
    "@echo off"
    '"%~dp0cz-cli.exe" agent %*'
  )
  $SkillsSource = Join-Path $ExtractDir "skills"
  Copy-BundledSkills $SkillsSource
  Install-ExternalAgentSkill $SkillsSource

  $MetadataDir = Join-Path $HOME ".clickzetta"
  New-Item -ItemType Directory -Force -Path $MetadataDir | Out-Null
  $Metadata = @{
    version = 1
    method = "curl"
    installed_path = $BinaryTarget
    channel = $Channel
    binary_version = $Version
    updated_at = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4
  Set-Content -LiteralPath (Join-Path $MetadataDir "install.json") -Value $Metadata

  Write-Host "Installed to $BinaryTarget"
  Repair-InstallDirPath $InstallDir
} finally {
  if (Test-Path $TempDir) {
    Remove-Item -LiteralPath $TempDir -Recurse -Force
  }
}
`
}

async function writeManifest(ctx, manifest) {
  if (ctx.dryRun) {
    console.log(`[dry-run] write manifest -> ${releaseMetaKey(manifest.version, "manifest.json")}`)
    console.log(JSON.stringify(manifest, null, 2))
    return
  }
  await putJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: manifest,
    key: releaseMetaKey(manifest.version, "manifest.json"),
    cacheControl: Cache.bootstrap,
    acl: "public-read",
  })
  console.log(`  ✓ manifest -> ${releaseMetaKey(manifest.version, "manifest.json")}`)
}

async function writeBootstrap(ctx, name, body, contentType) {
  if (ctx.dryRun) {
    console.log(`[dry-run] write ${name} -> ${releaseMetaKey(ctx.version, name)}`)
    return
  }
  await putText({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body,
    key: releaseMetaKey(ctx.version, name),
    contentType,
    cacheControl: Cache.bootstrap,
    acl: "public-read",
  })
  console.log(`  ✓ ${name} -> ${releaseMetaKey(ctx.version, name)}`)
}

async function writeChannelManifest(ctx, channel, manifest) {
  if (ctx.dryRun) {
    console.log(`[dry-run] write manifest -> ${metaKey(channel, "manifest.json")}`)
    return
  }
  await putJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: { ...manifest, channel },
    key: metaKey(channel, "manifest.json"),
    cacheControl: Cache.bootstrap,
    acl: "public-read",
  })
  console.log(`  ✓ manifest -> ${metaKey(channel, "manifest.json")}`)
}

async function writeChannelBootstrap(ctx, channel, name, body, contentType) {
  const target = metaKey(channel, name)
  if (ctx.dryRun) {
    console.log(`[dry-run] write ${name} -> ${target}`)
    return
  }
  await putText({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body,
    key: target,
    contentType,
    cacheControl: Cache.bootstrap,
    acl: "public-read",
  })
  console.log(`  ✓ ${name} -> ${target}`)
}

async function resolveChannelPromotions(ctx) {
  const channels = requestedChannels(ctx)
  if (ctx.dryRun) {
    return { existing: undefined, channels }
  }

  const existing = await getJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    key: metaRootKey("versions.json"),
  })
  return {
    existing,
    channels: channels.filter((channel) => {
      const current = typeof existing?.[channel] === "string" ? existing[channel].trim() : undefined
      if (current && compareReleaseVersions(ctx.version, current) < 0) {
        console.log(`  ⚠ skipping ${channel}: current ${current} > ${ctx.version}`)
        return false
      }
      return true
    }),
  }
}

async function updateVersions(ctx, channels, existingDoc) {
  const target = metaRootKey("versions.json")
  const existing = existingDoc ?? null
  const prior = (existing?.versions ?? []).filter((v) => v.version !== ctx.version)
  const channelTags = [...channels]
  const next = [
    {
      version: ctx.version,
      released_at: ctx.buildDate,
      channel_tags: channelTags,
    },
    ...prior,
  ].slice(0, ctx.retain)

  // Re-tag prior entries based on what we know
  for (const entry of next) {
    if (entry.version === ctx.version) continue
    entry.channel_tags = entry.channel_tags?.filter((t) => {
      return !channels.includes(t)
    }) ?? []
  }

  const doc = {
    updated_at: ctx.buildDate,
    stable: existing?.stable,
    nightly: existing?.nightly,
    versions: next,
  }
  if (channels.includes("nightly")) doc.nightly = ctx.version
  if (channels.includes("stable")) doc.stable = ctx.version

  if (ctx.dryRun) {
    console.log(`[dry-run] write ${target}`)
    console.log(JSON.stringify(doc, null, 2))
    return doc
  }
  await putJson({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    body: doc,
    key: target,
    cacheControl: Cache.short,
  })
  console.log(`  ✓ versions.json (kept ${next.length})`)
  return doc
}

async function retentionCleanup(ctx, versionsDoc) {
  const keep = new Set(versionsDoc.versions.map((v) => v.version))
  if (versionsDoc.stable) keep.add(versionsDoc.stable)
  if (versionsDoc.nightly) keep.add(versionsDoc.nightly)
  keep.add(ctx.version)

  if (ctx.dryRun) {
    console.log(`[dry-run] retention keep set: ${[...keep].join(", ")}`)
    return
  }

  const allKeys = await listPrefix({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    prefix: `${PATH_PREFIX}/`,
  })

  const versionDirs = new Map()
  for (const k of allKeys) {
    const rel = k.slice(PATH_PREFIX.length + 1)
    const m = rel.match(/^(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\//)
    if (!m) continue
    const ver = m[1]
    if (!versionDirs.has(ver)) versionDirs.set(ver, [])
    versionDirs.get(ver).push(k)
  }

  const toDelete = []
  for (const [ver, keys] of versionDirs) {
    if (!keep.has(ver)) toDelete.push(...keys)
  }

  if (toDelete.length === 0) {
    console.log(`  ✓ retention: nothing to delete (${versionDirs.size} versions on COS)`)
    return
  }

  await deleteObjects({
    client: ctx.client,
    Bucket: ctx.Bucket,
    Region: ctx.Region,
    keys: toDelete,
  })
  const evicted = [...versionDirs.keys()].filter((v) => !keep.has(v))
  console.log(
    `  ✓ retention: deleted ${toDelete.length} keys across ${evicted.length} version(s): ${evicted.join(", ")}`,
  )
}

function writeJobSummary(builds, manifest, versionsDoc) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return
  const lines = []
  lines.push(`## cz-cli release ${manifest.version}`)
  lines.push("")
  lines.push(`- commit: \`${manifest.commit}\``)
  lines.push(`- buildDate: \`${manifest.buildDate}\``)
  lines.push(`- versions kept: ${versionsDoc.versions.length}`)
  lines.push(`- channel pointers: stable=\`${versionsDoc.stable ?? "-"}\` nightly=\`${versionsDoc.nightly ?? "-"}\``)
  lines.push("")
  lines.push("| Platform | Archive | Size | SHA256 |")
  lines.push("|---|---|---:|---|")
  for (const [platform, p] of Object.entries(manifest.platforms)) {
    const sizeMb = p.size === 0 ? "-" : `${(p.size / 1024 / 1024).toFixed(1)} MB`
    lines.push(`| \`${platform}\` | \`${p.archive}\` | ${sizeMb} | \`${p.checksum.slice(0, 12)}…\` |`)
  }
  fs.appendFileSync(summaryPath, lines.join("\n") + "\n")
}

async function main() {
  const _log = console.log
  console.log = (...args) => _log(`[${new Date().toISOString()}]`, ...args)

  const args = parseArgs(process.argv.slice(2))
  validateArgs(args)

  console.log(`cz-cli COS release ${args.version} (dry-run=${args.dryRun})`)
  const platforms = detectPlatforms(args.dist)
  if (platforms.length === 0) {
    throw new Error(`No dist platforms found under ${args.dist}`)
  }
  console.log(`Detected ${platforms.length} platform(s): ${platforms.map((p) => p.platform).join(", ")}`)

  const archivesDir = path.join(args.dist, "archives")
  const builds = []
  for (const p of platforms) {
    const t0 = Date.now()
    const built = await archivePlatform({
      distPath: p.distPath,
      platform: p.platform,
      version: args.version,
      archivesDir,
    })
    console.log(`  ✓ Archived ${p.platform} (${formatBytes(built.size)}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`)
    builds.push({ platform: p.platform, targetKey: key(args.version, p.platform, built.archiveName), ...built })
  }
  logPreparedArchives(builds)

  const cos = args.dryRun
    ? { client: null, Bucket: process.env.COS_BUCKET ?? "DRY", Region: process.env.COS_REGION ?? "DRY", accelerate: false }
    : createClient()
  const ctx = { ...args, ...cos }

  console.log(`Uploading archives... (accelerate=${cos.accelerate ?? false})`)
  const uploadedPlatforms = await uploadAllArchives(ctx, builds)
  const manifestPlatforms = signArchiveUrls(ctx, builds, uploadedPlatforms)
  const promotionPlan = await resolveChannelPromotions(ctx)
  const manifest = buildManifest(ctx, manifestPlatforms, defaultManifestChannel(ctx.version, promotionPlan.channels))

  console.log("Writing META-INF assets...")
  await writeManifest(ctx, manifest)
  await writeBootstrap(
    ctx,
    "bootstrap.sh",
    renderBootstrapSh({
      version: manifest.version,
      channel: manifest.channel,
      platforms: manifest.platforms,
    }),
    "text/x-shellscript; charset=utf-8",
  )
  await writeBootstrap(
    ctx,
    "bootstrap.ps1",
    renderBootstrapPs1({
      version: manifest.version,
      channel: manifest.channel,
      platforms: manifest.platforms,
    }),
    "text/plain; charset=utf-8",
  )

  for (const channel of promotionPlan.channels) {
    console.log(`Updating /${channel} assets...`)
    await writeChannelManifest(ctx, channel, manifest)
    await writeChannelBootstrap(
      ctx,
      channel,
      "bootstrap.sh",
      renderBootstrapSh({
        version: manifest.version,
        channel,
        platforms: manifest.platforms,
      }),
      "text/x-shellscript; charset=utf-8",
    )
    await writeChannelBootstrap(
      ctx,
      channel,
      "bootstrap.ps1",
      renderBootstrapPs1({
        version: manifest.version,
        channel,
        platforms: manifest.platforms,
      }),
      "text/plain; charset=utf-8",
    )
  }

  console.log("Updating versions.json...")
  const versionsDoc = await updateVersions(ctx, promotionPlan.channels, promotionPlan.existing)

  console.log("Retention cleanup...")
  await retentionCleanup(ctx, versionsDoc)

  writeJobSummary(builds, manifest, versionsDoc)
  console.log("Done.")
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.stack ?? err.message ?? err)
    process.exit(1)
  })
}

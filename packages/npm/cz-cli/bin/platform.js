#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");

const SUPPORTED_PACKAGES = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
]);
const DEFAULT_FALLBACK_ROOT = path.join(__dirname, "fallback");

function normalizeArch(arch = os.arch()) {
  if (arch === "x64" || arch === "amd64") return "x64";
  if (arch === "arm64" || arch === "aarch64") return "arm64";
  return null;
}

function getPlatformSpec({
  platform = os.platform(),
  arch = os.arch(),
} = {}) {
  const normalizedArch = normalizeArch(arch);
  if (!normalizedArch) return null;
  const packageTarget = `${platform}-${normalizedArch}`;
  if (!SUPPORTED_PACKAGES.has(packageTarget)) return null;

  return {
    platform,
    arch: normalizedArch,
    binaryName: platform === "win32" ? "cz-cli.exe" : "cz-cli",
    packageName: `@clickzetta/cz-cli-${packageTarget}`,
  };
}

function resolvePackageDir(spec, resolve = require.resolve) {
  try {
    return path.dirname(resolve(`${spec.packageName}/package.json`));
  } catch {
    return null;
  }
}

function resolveBinaryFromRoot(rootDir, spec, existsSync = fs.existsSync) {
  if (!rootDir) return null;
  const binPath = path.join(rootDir, spec.binaryName);
  if (!existsSync(binPath)) return null;

  return {
    rootDir,
    binPath,
  };
}

function resolveInstalledBinary({
  spec = getPlatformSpec(),
  fallbackRoot = DEFAULT_FALLBACK_ROOT,
  resolvePackageDirFn = resolvePackageDir,
  existsSync = fs.existsSync,
} = {}) {
  if (!spec) return null;

  const packageDir = resolvePackageDirFn(spec);
  const packaged = resolveBinaryFromRoot(packageDir ? path.join(packageDir, "bin") : null, spec, existsSync);
  if (packaged) return { ...packaged, source: "package" };

  const fallback = resolveBinaryFromRoot(path.join(fallbackRoot, `${spec.platform}-${spec.arch}`), spec, existsSync);
  if (fallback) return { ...fallback, source: "fallback" };

  return null;
}

function parseOctal(buffer, start, end) {
  const value = buffer.toString("utf8", start, end).replace(/\0.*$/, "").trim();
  if (!value) return 0;
  return Number.parseInt(value, 8);
}

function sanitizeRelativePath(relativePath) {
  const normalized = path.posix.normalize(relativePath).replace(/^\/+/, "");
  if (!normalized || normalized.startsWith("../") || normalized === "..") return null;
  return normalized;
}

function extractBinFromTarball(archivePath, destinationDir) {
  const archive = zlib.gunzipSync(fs.readFileSync(archivePath));
  const resolvedDestinationDir = path.resolve(destinationDir);
  let offset = 0;

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
    const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
    const entryPath = sanitizeRelativePath(prefix ? `${prefix}/${name}` : name);
    const type = String.fromCharCode(header[156] || 0);
    const mode = parseOctal(header, 100, 108);
    const size = parseOctal(header, 124, 136);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const relative = entryPath && entryPath.startsWith("package/bin/") ? sanitizeRelativePath(entryPath.slice(12)) : null;

    if (relative) {
      const targetPath = path.resolve(resolvedDestinationDir, relative);
      if (!targetPath.startsWith(resolvedDestinationDir + path.sep) && targetPath !== resolvedDestinationDir) {
        throw new Error(`Refusing to extract unsafe path: ${relative}`);
      }

      if (type === "5") {
        fs.mkdirSync(targetPath, { recursive: true });
      } else if (type === "\0" || type === "0") {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, archive.subarray(dataStart, dataEnd));
        if (process.platform !== "win32") fs.chmodSync(targetPath, mode || 0o755);
      }
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }
}

async function installFromNpmRegistry({
  packageName,
  version,
  destinationDir,
} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cz-cli-npm-pack-"));

  try {
    const packed = execFileSync("npm", ["pack", `${packageName}@${version}`, "--silent"], {
      cwd: tempRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    })
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();

    if (!packed) throw new Error(`npm pack did not return a tarball name for ${packageName}@${version}`);

    extractBinFromTarball(path.join(tempRoot, packed), destinationDir);
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error && error.stderr
        ? String(error.stderr).trim()
        : error instanceof Error
          ? error.message
          : String(error);
    throw new Error(`npm registry self-heal failed for ${packageName}@${version}: ${detail}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function ensureInstalledBinary({
  spec = getPlatformSpec(),
  version = "latest",
  fallbackRoot = DEFAULT_FALLBACK_ROOT,
  resolvePackageDir: resolvePackageDirOverride,
  existsSync = fs.existsSync,
  installFromNpmRegistry: installFromNpmRegistryOverride = installFromNpmRegistry,
  force = false,
} = {}) {
  if (!spec) throw new Error(`Unsupported platform/arch: ${os.platform()}/${os.arch()}`);

  if (!force) {
    const installed = resolveInstalledBinary({
      spec,
      fallbackRoot,
      resolvePackageDirFn: resolvePackageDirOverride || resolvePackageDir,
      existsSync,
    });
    if (installed) return installed;
  }

  const destinationDir = path.join(fallbackRoot, `${spec.platform}-${spec.arch}`);
  fs.rmSync(destinationDir, { recursive: true, force: true });
  fs.mkdirSync(destinationDir, { recursive: true });
  await installFromNpmRegistryOverride({
    packageName: spec.packageName,
    version,
    destinationDir,
    binaryName: spec.binaryName,
  });

  const fallback = resolveInstalledBinary({
    spec,
    fallbackRoot,
    resolvePackageDirFn: () => null,
    existsSync,
  });
  if (fallback) return fallback;

  throw new Error(
    `Unable to install cz-cli binary for ${spec.platform}-${spec.arch} from package ${spec.packageName} or npm registry fallback.`,
  );
}

module.exports = {
  DEFAULT_FALLBACK_ROOT,
  ensureInstalledBinary,
  getPlatformSpec,
  resolveInstalledBinary,
};

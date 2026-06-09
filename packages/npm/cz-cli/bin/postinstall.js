#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DEFAULT_FALLBACK_ROOT, ensureInstalledBinary, getPlatformSpec } = require("./platform");

const home = os.homedir();
const installFile = path.join(home, ".clickzetta", "install.json");
const version = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).version;

function cleanupOutdatedBinaries() {
  // Only remove standalone binaries in ~/.local/bin that are not symlinks
  // (npm/bun create symlinks in their bin dirs, standalone installs are real files)
  const localBin = path.join(home, ".local", "bin", "cz-cli");
  try {
    if (fs.existsSync(localBin) && !fs.lstatSync(localBin).isSymbolicLink()) {
      fs.unlinkSync(localBin);
      process.stderr.write(`Removed outdated standalone binary: ${localBin}\n`);
    }
  } catch (e) {
    // Permission denied or other error — skip silently
  }

  // Detect pip-installed cz-cli and warn user to uninstall it
  try {
    const result = execFileSync("pip3", ["show", "cz-cli"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      timeout: 5000,
    });
    if (result && result.includes("Name: cz-cli")) {
      process.stderr.write(
        "\n⚠️  Detected a pip-installed cz-cli that may conflict with this npm installation.\n" +
        "   Please remove it with: pip3 uninstall cz-cli\n\n",
      );
    }
  } catch (e) {
    // pip3 not found or command failed — skip silently
  }
}

async function main() {
  // Clean up outdated standalone cz-cli binaries that may shadow this npm installation
  cleanupOutdatedBinaries();

  const spec = getPlatformSpec();
  if (!spec) return;

  // Force re-install to ensure the platform binary matches the version being
  // installed. ensureInstalledBinary will prefer the optionalDependency package
  // when available, falling back to npm pack only when necessary.
  const installed = await ensureInstalledBinary({
    spec,
    version,
    fallbackRoot: DEFAULT_FALLBACK_ROOT,
    force: true,
  });
  // Install bundled skills into ~/.clickzetta/skills/.builtin/
  const skillsSrc = path.join(installed.rootDir, "skills");
  const builtinDest = path.join(home, ".clickzetta", "skills", ".builtin");

  // Clean up legacy skill installations in agent directories
  const agentDirs = [
    path.join(home, ".claude", "skills"),
    path.join(home, ".kiro", "skills"),
    path.join(home, ".cursor", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".openclaw", "workspace", "skills"),
    path.join(home, ".singclaw", "workspace", "skills"),
  ];
  for (const dir of agentDirs) {
    for (const legacy of ["czagent", "czcli", "cz-cli-v2", "cz-cli"]) {
      try { fs.rmSync(path.join(dir, legacy), { recursive: true, force: true }); } catch (e) {}
    }
  }

  // Clear .builtin/ entirely then re-populate with all bundled skills
  fs.rmSync(builtinDest, { recursive: true, force: true });
  fs.mkdirSync(builtinDest, { recursive: true });
  if (fs.existsSync(skillsSrc)) {
    const skills = fs.readdirSync(skillsSrc).filter((name) => fs.statSync(path.join(skillsSrc, name)).isDirectory());
    for (const name of skills) {
      fs.cpSync(path.join(skillsSrc, name), path.join(builtinDest, name), { recursive: true });
    }
  }

  // Install cz-agent convenience wrapper alongside the binary
  const czCliDir = path.join(home, ".cz-cli", "bin");
  fs.mkdirSync(czCliDir, { recursive: true });
  const agentWrapper = path.join(czCliDir, "cz-agent");
  fs.writeFileSync(agentWrapper, `#!/bin/sh\nexec "${installed.binPath}" agent "$@"\n`, { mode: 0o755 });

  try {
    execFileSync(installed.binPath, [], {
      stdio: "ignore",
      env: { ...process.env, CLICKZETTA_MIGRATE_PROFILES_ONLY: "1" },
    });
  } catch (e) {}

  try {
    const binaryVersion = execFileSync(installed.binPath, ["--version"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
      env: process.env,
    }).trim();
    const channel = process.env.CZ_CHANNEL === "nightly" ? "nightly" : "stable";
    fs.mkdirSync(path.dirname(installFile), { recursive: true });
    fs.writeFileSync(
      installFile,
      JSON.stringify(
        {
          version: 1,
          installed_path: installed.binPath,
          channel,
          binary_version: binaryVersion,
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
  } catch (e) {}
}

main().catch((error) => {
  process.stderr.write(
    `Failed to install cz-cli binary:\n${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stderr.write("npm installed the launcher package, but the platform binary could not be prepared from npm.\n");
  process.stderr.write("Check npm config for omit=optional / optional=false and ensure npm registry access works.\n");
  process.exit(1);
});

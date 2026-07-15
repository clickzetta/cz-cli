#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { DEFAULT_FALLBACK_ROOT, getPlatformSpec, resolveInstalledBinary, ensureInstalledBinary } = require("./platform");

const spec = getPlatformSpec();
const expectedVersion = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")).version;

async function run() {
  if (!spec) {
    console.error("Error: Unsupported platform.");
    process.exit(1);
  }

  let installed = resolveInstalledBinary({ spec, fallbackRoot: DEFAULT_FALLBACK_ROOT });

  if (installed) {
    try {
      const binaryVersion = execFileSync(installed.binPath, ["--version"], {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      // If launcher package has a real version (not placeholder) and binary differs, force update
      if (expectedVersion !== "0.1.0" && binaryVersion && !binaryVersion.includes(expectedVersion)) {
        installed = await ensureInstalledBinary({ spec, version: expectedVersion, fallbackRoot: DEFAULT_FALLBACK_ROOT, force: true });
      }
    } catch {
      installed = await ensureInstalledBinary({ spec, version: expectedVersion, fallbackRoot: DEFAULT_FALLBACK_ROOT, force: true });
    }
  } else {
    installed = await ensureInstalledBinary({ spec, version: expectedVersion, fallbackRoot: DEFAULT_FALLBACK_ROOT });
  }

  if (!installed) {
    console.error(`Error: Platform binary not found (${spec.packageName}).`);
    console.error("Fix: npm install -g @clickzetta/cz-cli@latest --ignore-scripts=false");
    process.exit(1);
  }

  execFileSync(installed.binPath, process.argv.slice(2), { stdio: "inherit", env: process.env });
}

run().catch((e) => {
  if (e && e.status !== undefined) process.exit(e.status);
  console.error(`Error: ${e && e.message ? e.message : e}`);
  console.error("Fix: npm install -g @clickzetta/cz-cli@latest --ignore-scripts=false");
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const { DEFAULT_FALLBACK_ROOT, getPlatformSpec, resolveInstalledBinary } = require("./platform");

const spec = getPlatformSpec();

try {
  const installed = resolveInstalledBinary({
    spec,
    fallbackRoot: DEFAULT_FALLBACK_ROOT,
  });
  if (!installed) throw new Error("missing binary");

  execFileSync(installed.binPath, process.argv.slice(2), { stdio: "inherit", env: process.env });
} catch (e) {
  if (e.status !== undefined) process.exit(e.status);
  console.error(`Error: Platform binary not found (${spec ? spec.packageName : "unsupported-platform"}).`);
  console.error("Fix: reinstall with npm so postinstall can repair the platform binary from npm registry");
  console.error("  npm install -g @clickzetta/cz-cli@latest --ignore-scripts=false");
  console.error("If this still fails, check npm config for omit=optional / optional=false and registry access.");
  process.exit(1);
}

#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const platform = os.platform();
const arch = os.arch() === "x64" ? "x64" : "arm64";
const pkgName = `@clickzetta/cz-cli-${platform}-${arch}`;
const binName = platform === "win32" ? "cz-cli.exe" : "cz-cli";

try {
  const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
  const binPath = path.join(pkgDir, "bin", binName);
  execFileSync(binPath, process.argv.slice(2), { stdio: "inherit", env: process.env });
} catch (e) {
  if (e.status !== undefined) process.exit(e.status);
  console.error(`Error: Platform binary not found (${pkgName}).`);
  console.error(`Fix: npm install -g @clickzetta/cz-cli@latest`);
  console.error(`Or:  curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh`);
  process.exit(1);
}

#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const path = require("path");
const os = require("os");

const platform = os.platform();
const arch = os.arch() === "x64" ? "x64" : "arm64";
const pkgName = `@clickzetta/cz-cli-${platform}-${arch}`;
const binName = platform === "win32" ? "czcli.exe" : "czcli";

try {
  const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
  const binPath = path.join(pkgDir, "bin", binName);
  const result = execFileSync(binPath, process.argv.slice(2), {
    stdio: "inherit",
    env: process.env,
  });
} catch (e) {
  if (e.status !== undefined) {
    process.exit(e.status);
  }
  console.error(`Error: Platform ${platform}-${arch} is not supported by @clickzetta/cz-cli.`);
  console.error(`Try installing directly: curl -fsSL https://github.com/clickzetta/cz-cli/releases/latest/download/install.sh | sh`);
  process.exit(1);
}

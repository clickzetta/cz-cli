#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const home = os.homedir();
const platform = os.platform();
const arch = os.arch() === "x64" ? "x64" : "arm64";
const pkgName = `@clickzetta/cz-cli-${platform}-${arch}`;

try {
  const pkgDir = path.dirname(require.resolve(`${pkgName}/package.json`));
  const skillsSrc = path.join(pkgDir, "bin", "skills");
  if (!fs.existsSync(skillsSrc)) process.exit(0);

  const skills = fs.readdirSync(skillsSrc).filter((name) =>
    fs.statSync(path.join(skillsSrc, name)).isDirectory()
  );

  // 1. cz-cli skill → external agent directories (subagent registration)
  const agentDirs = [
    path.join(home, ".claude", "skills"),
    path.join(home, ".kiro", "skills"),
    path.join(home, ".cursor", "skills"),
    path.join(home, ".codex", "skills"),
    path.join(home, ".openclaw", "workspace", "skills"),
    path.join(home, ".singclaw", "workspace", "skills"),
  ];
  if (skills.includes("cz-cli")) {
    const src = path.join(skillsSrc, "cz-cli");
    for (const dir of agentDirs) {
      const dest = path.join(dir, "cz-cli");
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.rmSync(dest, { recursive: true, force: true });
        fs.cpSync(src, dest, { recursive: true });
      } catch (e) {}
    }
  }

  // 2. All other skills → ~/.clickzetta/skills/ (cz-cli internal use)
  const internalDest = path.join(home, ".clickzetta", "skills");
  fs.mkdirSync(internalDest, { recursive: true });
  for (const name of skills) {
    if (name === "cz-cli") continue;
    const src = path.join(skillsSrc, name);
    const dest = path.join(internalDest, name);
    try {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    } catch (e) {}
  }
} catch (e) {
  // Non-fatal: don't block npm install
}

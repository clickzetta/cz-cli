#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const home = os.homedir();
const platform = os.platform();
const arch = os.arch() === "x64" ? "x64" : "arm64";
const pkgName = `@clickzetta/cz-cli-${platform}-${arch}`;
const binName = platform === "win32" ? "cz-cli.exe" : "cz-cli";

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

  // Cleanup: fix cz-cli-v2 → cz-cli in existing skill files (bug introduced in 57a49fcdc)
  for (const dir of agentDirs) {
    const skillFile = path.join(dir, "cz-cli", "SKILL.md");
    try {
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, "utf-8");
        if (content.includes("name: cz-cli-v2")) {
          fs.writeFileSync(skillFile, content.replace("name: cz-cli-v2", "name: cz-cli"), "utf-8");
        }
      }
    } catch (e) {}
  }

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

  // 2. All other skills → ~/.clickzetta/skills/.builtin/ (cz-cli managed, safe to overwrite)
  const internalDest = path.join(home, ".clickzetta", "skills", ".builtin");
  fs.mkdirSync(internalDest, { recursive: true });

  // Migrate: remove legacy skills that were previously installed directly in ~/.clickzetta/skills/
  const legacyDir = path.join(home, ".clickzetta", "skills");
  for (const name of skills) {
    if (name === "cz-cli") continue;
    const legacy = path.join(legacyDir, name);
    if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory()) {
      try { fs.rmSync(legacy, { recursive: true, force: true }); } catch (e) {}
    }
  }

  for (const name of skills) {
    if (name === "cz-cli") continue;
    const src = path.join(skillsSrc, name);
    const dest = path.join(internalDest, name);
    try {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
    } catch (e) {}
  }

  try {
    execFileSync(path.join(pkgDir, "bin", binName), [], {
      stdio: "ignore",
      env: { ...process.env, CLICKZETTA_MIGRATE_PROFILES_ONLY: "1" },
    });
  } catch (e) {}
} catch (e) {
  // Non-fatal: don't block npm install
}

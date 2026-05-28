import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..")

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function createArtifact(root, name, binaryName) {
  const binDir = path.join(root, "artifacts", name, "bin")
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, binaryName), "")
}

test("npm-publish uses dev dist-tag for prerelease versions", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cz-npm-publish-"))
  fs.mkdirSync(path.join(tempRoot, "scripts"), { recursive: true })
  fs.copyFileSync(path.join(REPO_ROOT, "scripts", "npm-publish.sh"), path.join(tempRoot, "scripts", "npm-publish.sh"))

  writeJson(path.join(tempRoot, "packages", "npm", "cz-cli", "package.json"), {
    name: "@clickzetta/cz-cli",
    version: "0.1.0",
    optionalDependencies: {
      "@clickzetta/cz-cli-darwin-arm64": "0.1.0",
      "@clickzetta/cz-cli-darwin-x64": "0.1.0",
      "@clickzetta/cz-cli-win32-x64": "0.1.0",
    },
  })
  writeJson(path.join(tempRoot, "packages", "npm", "cz-cli-darwin-arm64", "package.json"), {
    name: "@clickzetta/cz-cli-darwin-arm64",
    version: "0.1.0",
  })
  writeJson(path.join(tempRoot, "packages", "npm", "cz-cli-darwin-x64", "package.json"), {
    name: "@clickzetta/cz-cli-darwin-x64",
    version: "0.1.0",
  })
  writeJson(path.join(tempRoot, "packages", "npm", "cz-cli-win32-x64", "package.json"), {
    name: "@clickzetta/cz-cli-win32-x64",
    version: "0.1.0",
  })

  createArtifact(tempRoot, "cz-cli-darwin-arm64", "cz-cli")
  createArtifact(tempRoot, "cz-cli-darwin-x64", "cz-cli")
  createArtifact(tempRoot, "cz-cli-windows-x64", "cz-cli.exe")

  try {
    const output = execFileSync(
      "bash",
      [path.join(tempRoot, "scripts", "npm-publish.sh"), "1.2.3-dev.4", path.join(tempRoot, "artifacts")],
      {
        cwd: tempRoot,
        env: { ...process.env, DRY_RUN: "1" },
        encoding: "utf8",
      },
    )

    assert.match(output, /\[dry-run\] npm publish --access public --tag dev/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

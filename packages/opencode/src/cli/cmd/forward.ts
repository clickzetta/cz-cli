import os from "os"
import path from "path"

export function resolveCzTool(): string {
  const name = process.platform === "win32" ? "cz-tool.exe" : "cz-tool"
  return path.join(os.homedir(), ".clickzetta", "cz-tool", name)
}

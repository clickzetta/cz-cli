## Why

Windows 用户通过 `irm https://cz-cli.ai/install.ps1 | iex` 安装时，旧版 Windows PowerShell 缺少 `irm` alias，当前 `install.ps1` 又包含 PowerShell 7 专用语法，导致默认系统 shell 难以完成安装。即使安装成功，脚本只提示手动添加 `%USERPROFILE%\.local\bin` 到 PATH，用户在新 shell 中仍无法直接运行 `cz-cli`。

## What Changes

- 将 Windows `install.ps1` 生成为 Windows PowerShell 5.1 可解析的脚本，避免使用 PowerShell 7 专用语法。
- 为 Windows 安装说明提供兼容老 PowerShell 的下载执行命令，不依赖 `irm` alias。
- 安装成功后自动把安装目录写入 User PATH，并同步当前 PowerShell 进程的 `$env:Path`。
- 保持 `INSTALL_DIR` 覆盖、版本检查、校验和验证、`install.json` 写入和 `cz-agent.cmd` wrapper 行为不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `auto-update`: Windows PowerShell 安装入口的 shell 兼容性与 PATH 注册行为。

## Impact

- `scripts/cos-release.mjs` 的 `renderBootstrapPs1` 输出。
- `openspec/specs/auto-update/spec.md` 的安装脚本行为要求。
- 覆盖 COS release 生成逻辑的测试。

## Context

当前 `install.ps1` 由 `scripts/cos-release.mjs` 的 `renderBootstrapPs1` 生成。脚本默认安装到 `$HOME\.local\bin`，复制 `cz-cli.exe` 和 `cz-agent.cmd`，写入 `~\.clickzetta\install.json`，但当安装目录不在 PATH 中时只输出提示。Windows 11 用户常见默认 shell 仍是 Windows PowerShell 5.1，甚至旧环境可能缺少 `irm` alias；当前脚本使用 `??` 等 PowerShell 7 语法，因此不能作为兼容安装入口。

## Goals / Non-Goals

**Goals:**

- 生成的 Windows `install.ps1` 必须可被 Windows PowerShell 5.1 解析。
- 安装成功后，默认安装目录或 `INSTALL_DIR` 指定目录必须进入 User PATH，并立即追加到当前进程 `$env:Path`。
- 安装输出必须给出不依赖 `irm` 的兼容命令，帮助旧 PowerShell 用户复制执行。
- 保留现有版本比较、下载、校验、安装元数据和 `cz-agent.cmd` wrapper 行为。

**Non-Goals:**

- 不支持 Windows PowerShell 2.x 直接执行完整安装脚本；脚本目标基线是 Windows PowerShell 5.1。
- 不改变 Windows binary 签名策略。
- 不改变 macOS/Linux `install.sh` 行为。

## Decisions

1. **以 PowerShell 5.1 作为脚本语法基线。**  
   Windows 11 默认包含 Windows PowerShell 5.1；PowerShell 7 不是系统默认组件。将 `??` 改为显式数组长度检查，避免解析期失败。替代方案是要求用户安装 PowerShell 7，但这会让默认 Windows 安装路径不够自助。

2. **写入 User PATH，而不是 Machine PATH。**  
   安装目录位于用户 home 下，写入 User PATH 不需要管理员权限，也与当前安装作用域一致。Machine PATH 需要提权，且会把单用户目录暴露给所有用户。

3. **同时更新当前进程 PATH。**  
   `[Environment]::SetEnvironmentVariable(..., "User")` 只影响后续进程。为了让安装命令结束后同一个 PowerShell 窗口可直接运行 `cz-cli`，脚本还要追加 `$env:Path`。

4. **PATH 判断做大小写无关和末尾分隔符归一。**  
   Windows 路径大小写不敏感，用户 PATH 中可能包含尾随 `\`。脚本需要避免重复追加同一目录。

## Risks / Trade-offs

- **PATH 写入失败** -> 安装不能因为 PATH 注册失败而丢失已下载 binary；脚本应输出明确 warning 和手动命令。
- **企业策略限制环境变量写入** -> 同上，保留安装成功结果与手动修复提示。
- **User PATH 已接近 Windows 长度限制** -> 使用追加策略；若系统拒绝写入，提示用户手动处理。

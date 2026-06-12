# setup 规格说明

## Purpose
定义 `cz-cli setup` 的交互式引导行为，确保用户可以通过账号站点获取 credential 并完成本地 profile 配置。

## Requirements

### Requirement: 交互式账号站点打开为 best-effort

`cz-cli setup` 在交互式流程中展示登录或注册链接后 MAY 尝试打开系统浏览器，但浏览器打开失败 MUST NOT 中断 setup 流程。命令 MUST 始终把 URL 显示给用户，并继续等待用户粘贴 credential。

#### Scenario: Windows 使用 shell 内建 start 打开浏览器

- **WHEN** `cz-cli setup` 在 Windows 交互式流程中打开登录或注册链接
- **THEN** 命令通过 `cmd.exe /c start "" <url>` 调用系统浏览器
- **且** 不直接 spawn `start`

#### Scenario: 浏览器打开失败后继续等待 credential

- **WHEN** 系统浏览器打开命令不存在或启动失败
- **THEN** `cz-cli setup` 不应抛出未处理异常
- **且** 用户仍然可以根据终端中显示的 URL 手动打开页面并粘贴 credential

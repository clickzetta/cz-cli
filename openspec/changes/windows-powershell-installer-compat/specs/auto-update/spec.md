## ADDED Requirements

### Requirement: Windows PowerShell 安装入口兼容默认系统 shell

Windows `install.ps1` 安装入口 MUST 使用 Windows PowerShell 5.1 可解析的语法，并 MUST 提供不依赖 `irm` alias 的兼容下载执行命令。

#### Scenario: Windows PowerShell 5.1 可解析安装脚本

- **WHEN** 用户在 Windows PowerShell 5.1 中下载并执行 `install.ps1`
- **THEN** 脚本解析阶段不因 PowerShell 7 专用语法失败

#### Scenario: 旧 PowerShell 无 irm alias 时仍有安装命令

- **WHEN** 用户环境中不存在 `irm` alias
- **THEN** 安装说明提供基于 `Net.WebClient.DownloadString` 的命令执行 `install.ps1`

### Requirement: Windows 安装成功后注册 User PATH

Windows `install.ps1` 安装成功后 MUST 将安装目录注册到当前用户 PATH，并 MUST 同步当前 PowerShell 进程的 `$env:Path`。如果 PATH 注册失败，脚本 MUST 保留已安装 binary 并输出手动修复提示。

#### Scenario: 默认安装目录写入 User PATH

- **WHEN** `install.ps1` 将 `cz-cli.exe` 安装到默认目录 `$HOME\.local\bin` 且该目录不在 User PATH 中
- **THEN** 脚本将该目录追加到 User PATH
- **AND** 当前 PowerShell 进程可通过 `cz-cli` 解析到安装目录中的 binary

#### Scenario: INSTALL_DIR 覆盖目录写入 User PATH

- **WHEN** `INSTALL_DIR` 环境变量指定自定义安装目录且该目录不在 User PATH 中
- **THEN** 脚本将该自定义目录追加到 User PATH

#### Scenario: PATH 已包含安装目录时不重复追加

- **WHEN** User PATH 已包含大小写不同或带尾随分隔符的安装目录
- **THEN** 脚本不重复追加该目录

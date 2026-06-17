# macos-gatekeeper 规格说明

## Purpose
定义 cz-cli 在 macOS 上安装/更新后消除 Gatekeeper 阻断的行为契约，确保二进制在首次运行时不被 SIGKILL。

## 背景

CI 构建时对 macOS 二进制执行 ad-hoc 签名（`codesign --force --sign -`）并清除 quarantine bit（`xattr -dr com.apple.quarantine`）。但 `unzip` / npm 包提取时会将 zip 包本身携带的 `com.apple.quarantine` xattr 传播到解压出的文件，导致 Gatekeeper 在首次执行时 SIGKILL 进程。

## Requirements
### Requirement: install.sh 下载安装后清除 quarantine 并重新签名

本需求 MUST 按以下场景执行。

`scripts/install.sh` 的 `download_and_install` 函数在将二进制 mv 到 `$INSTALL_DIR` 后，必须在 macOS 上清除 quarantine bit 并重新执行 ad-hoc 签名。

#### Scenario: curl 安装后首次运行不被 kill

- **WHEN** 用户通过 `curl | sh` 安装 cz-cli，且操作系统为 macOS
- **THEN** 安装完成后 `xattr -dr com.apple.quarantine` 已在二进制上执行
- **AND** `codesign --force --sign -` 已在二进制上执行
- **AND** 执行 `cz-cli --version` 不被 Gatekeeper SIGKILL

### Requirement: install.sh --binary 路径同样清除 quarantine 并重新签名

本需求 MUST 按以下场景执行。

`install_from_binary` 函数同样需要在 macOS 上执行清除和重签操作，因为本地二进制文件可能携带从其他来源继承的 quarantine bit。

#### Scenario: 本地二进制安装后可正常运行

- **WHEN** 用户通过 `install.sh --binary /path/to/cz-cli` 安装，且操作系统为 macOS
- **THEN** 安装后二进制不携带 quarantine bit
- **AND** 二进制持有有效的 ad-hoc 签名

### Requirement: npm postinstall 清除 quarantine 并重新签名

本需求 MUST 按以下场景执行。

`packages/npm/cz-cli/bin/postinstall.js` 在 `ensureInstalledBinary` 完成后，必须在 macOS 上清除 quarantine bit 并重新执行 ad-hoc 签名。

#### Scenario: npm install 后首次运行不被 kill

- **WHEN** 用户通过 `npm install -g @clickzetta/cz-cli` 安装，且操作系统为 macOS
- **THEN** postinstall 执行后二进制不携带 quarantine bit
- **AND** 二进制持有有效的 ad-hoc 签名

### Requirement: 签名操作不得中断安装流程

本需求 MUST 按以下场景执行。

所有 `xattr` 和 `codesign` 调用必须是非致命的——失败时静默忽略，不影响安装的整体成功判断。

#### Scenario: xattr 或 codesign 失败时安装继续

- **WHEN** macOS 安装过程中 `xattr` 或 `codesign` 返回非零退出码
- **THEN** 安装流程继续执行后续步骤
- **AND** 安装结果不得仅因签名修复失败而标记为失败

### Requirement: 自动更新恢复重启路径后重新签名

本需求 MUST 按以下场景执行。

自动更新若发现 install.sh 将目标版本安装到不同自管目录，并将该 binary 拷贝回原 `process.execPath` 重启路径，则在 macOS 上必须对恢复后的重启路径执行 quarantine 清理和 ad-hoc 重新签名，确保后续 restart 不被 Gatekeeper SIGKILL。

#### Scenario: 恢复 restart binary 后首次运行不被 kill

- **WHEN** 自动更新将目标版本 binary 从 `~/.local/bin/cz-cli` 拷贝回原重启路径，且操作系统为 macOS
- **THEN** 自动更新对恢复后的 binary 执行 `xattr -dr com.apple.quarantine`
- **AND** 自动更新对恢复后的 binary 执行 `codesign --force --sign -`
- **AND** 重启后的 `cz-cli --version` 不被 Gatekeeper SIGKILL

#### Scenario: codesign 不可用时安装仍成功

- **WHEN** 系统未安装 Xcode Command Line Tools（`codesign` 不在 PATH）
- **THEN** 安装流程继续，不抛出错误

#### Scenario: 非 macOS 系统不执行签名操作

- **WHEN** 操作系统为 Linux 或 Windows
- **THEN** `xattr` 和 `codesign` 调用不执行

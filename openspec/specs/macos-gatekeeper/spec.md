# macos-gatekeeper 规格说明

## 目的

定义 cz-cli 在 macOS 上安装/更新后消除 Gatekeeper 阻断的行为契约，确保二进制在首次运行时不被 SIGKILL。

## 背景

CI 构建时对 macOS 二进制执行 ad-hoc 签名（`codesign --force --sign -`）并清除 quarantine bit（`xattr -dr com.apple.quarantine`）。但 `unzip` / npm 包提取时会将 zip 包本身携带的 `com.apple.quarantine` xattr 传播到解压出的文件，导致 Gatekeeper 在首次执行时 SIGKILL 进程。

## 需求

### 需求：install.sh 下载安装后清除 quarantine 并重新签名

`scripts/install.sh` 的 `download_and_install` 函数在将二进制 mv 到 `$INSTALL_DIR` 后，必须在 macOS 上清除 quarantine bit 并重新执行 ad-hoc 签名。

#### 场景：curl 安装后首次运行不被 kill

- **WHEN** 用户通过 `curl | sh` 安装 cz-cli，且操作系统为 macOS
- **THEN** 安装完成后 `xattr -dr com.apple.quarantine` 已在二进制上执行
- **AND** `codesign --force --sign -` 已在二进制上执行
- **AND** 执行 `cz-cli --version` 不被 Gatekeeper SIGKILL

### 需求：install.sh --binary 路径同样清除 quarantine 并重新签名

`install_from_binary` 函数同样需要在 macOS 上执行清除和重签操作，因为本地二进制文件可能携带从其他来源继承的 quarantine bit。

#### 场景：本地二进制安装后可正常运行

- **WHEN** 用户通过 `install.sh --binary /path/to/cz-cli` 安装，且操作系统为 macOS
- **THEN** 安装后二进制不携带 quarantine bit
- **AND** 二进制持有有效的 ad-hoc 签名

### 需求：npm postinstall 清除 quarantine 并重新签名

`packages/npm/cz-cli/bin/postinstall.js` 在 `ensureInstalledBinary` 完成后，必须在 macOS 上清除 quarantine bit 并重新执行 ad-hoc 签名。

#### 场景：npm install 后首次运行不被 kill

- **WHEN** 用户通过 `npm install -g @clickzetta/cz-cli` 安装，且操作系统为 macOS
- **THEN** postinstall 执行后二进制不携带 quarantine bit
- **AND** 二进制持有有效的 ad-hoc 签名

### 需求：签名操作不得中断安装流程

所有 `xattr` 和 `codesign` 调用必须是非致命的——失败时静默忽略，不影响安装的整体成功判断。

#### 场景：codesign 不可用时安装仍成功

- **WHEN** 系统未安装 Xcode Command Line Tools（`codesign` 不在 PATH）
- **THEN** 安装流程继续，不抛出错误

#### 场景：非 macOS 系统不执行签名操作

- **WHEN** 操作系统为 Linux 或 Windows
- **THEN** `xattr` 和 `codesign` 调用不执行

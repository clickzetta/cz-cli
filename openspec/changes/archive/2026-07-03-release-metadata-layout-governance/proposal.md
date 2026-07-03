## Why

当前发布元数据的 spec 把 channel 指针、channel 安装资产、历史版本资产混在一起，导致实现过程中容易误把 `META-INF/<channel>` 同时设计成对象和目录，或新增 `META-INF/channels/<channel>/version` 这类重复指针。对象存储虽然允许近似“文件/目录重名”的 key，但该结构对控制台、同步工具、本地镜像和实现者都不清晰。

需要把发布元数据职责治理成单一、可测试、无重名的布局，并明确官网、CLI update、发布脚本的消费边界。

## What Changes

- 明确 `META-INF/versions.json` 是唯一 channel 指针来源，顶层 `stable`/`nightly` 字段记录当前版本。
- 将 `META-INF/channels/<channel>/...` 定义为当前渠道安装资产目录，只包含 `manifest.json`、`bootstrap.sh`、`bootstrap.ps1`，不包含 `version` 指针。
- 将 `META-INF/releases/<version>/...` 定义为历史版本资产目录，显式版本安装必须读取 `manifest.json` 并使用其中记录的 presigned archive URL。
- 禁止消费端读取或创建 `META-INF/stable`、`META-INF/nightly`、`META-INF/channels/<channel>/version` 等额外 channel 指针。
- 明确 publish/promote 的 downgrade guard 必须以 `versions.json` 当前指针为准，且拒绝时不得更新 channel 安装资产。
- 明确 Windows `update -t` 和 `/install.ps1?version=` 与 Unix 路径使用同一 release manifest 契约。

## Capabilities

### New Capabilities

### Modified Capabilities

- `release-channel`: 治理 COS 发布元数据布局、channel 指针唯一来源、channel 资产和 historical release 资产边界。
- `binary-distribution`: 明确当前渠道安装和显式历史版本安装都不得拼接公开 COS URL，必须走 manifest/presigned URL 契约。
- `auto-update`: 明确 `/api/stable`、`/api/nightly` 的版本来源是 `META-INF/versions.json` 顶层字段，禁止额外 channel 指针对象。

## Impact

- `scripts/cos-release.mjs`：发布时写入 `META-INF/channels/<channel>/...` 和 `META-INF/releases/<version>/...`，并只通过 `versions.json` 更新 channel 指针。
- `scripts/cos-promote.mjs`：promote 时校验 release manifest、检查 `versions.json` downgrade guard、同步 channel 资产并更新 `versions.json`。
- `/Users/zhanglin/IdeaProjects/cz-cli-website/src/routes/*`：官网 API、install、download 路由按新布局读取元数据。
- `packages/opencode/src/update/bootstrap.ts`：Windows 指定版本更新使用 `/install.ps1?version=<version>`。
- 测试覆盖 release 脚本、promote、官网路由、Windows/Unix 指定版本 update。

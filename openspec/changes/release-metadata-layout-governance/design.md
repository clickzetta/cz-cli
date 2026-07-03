## Context

当前 COS 元数据已有 `META-INF/versions.json`，其中顶层 `stable` 和 `nightly` 字段记录当前渠道版本，`versions[]` 记录近期版本列表。此前讨论中曾把 channel 指针拆到 `META-INF/<channel>` 或 `META-INF/channels/<channel>/version`，这会产生重复事实来源，也容易与 `META-INF/<channel>/manifest.json` 形成对象/目录语义冲突。

目标结构需要同时满足：

```text
META-INF/versions.json                         # 唯一 channel 指针 + 版本索引
META-INF/channels/stable/manifest.json         # 当前 stable 安装资产
META-INF/channels/stable/bootstrap.sh
META-INF/channels/stable/bootstrap.ps1
META-INF/channels/nightly/manifest.json        # 当前 nightly 安装资产
META-INF/channels/nightly/bootstrap.sh
META-INF/channels/nightly/bootstrap.ps1
META-INF/releases/<version>/manifest.json      # 历史版本安装资产
META-INF/releases/<version>/bootstrap.sh
META-INF/releases/<version>/bootstrap.ps1
```

`<version>/...` 构建产物目录保持私有，不公开 manifest，不作为消费入口。下载归档统一经 manifest 内记录的长期 presigned URL。

## Goals / Non-Goals

**Goals:**

- 消除 channel 指针对象与 channel 资产目录的重名/重复来源。
- 将 stable/nightly 当前版本解析统一到 `META-INF/versions.json`。
- 让默认安装、显式历史版本安装、promote、auto-update 使用同一元数据模型。
- 让 Windows PowerShell 路径与 Unix shell 路径遵守同一 release manifest 契约。

**Non-Goals:**

- 不改变归档对象私有权限策略。
- 不引入新的公开 `<version>/manifest.json`。
- 不把 presigned URL 写入 `versions.json`。
- 不改变 npm 包结构或 GitHub Release 产物结构。

## Decisions

### 1. `versions.json` 是唯一 channel 指针

保留现有 `versions.json.stable` / `versions.json.nightly`，不再创建任何额外指针对象。

原因：线上已经有该结构，且它同时承担版本索引和当前 channel 标签职责。新增 `channels/<channel>/version` 会制造重复事实来源，后续一致性和回滚都更复杂。

### 2. `channels/<channel>/` 只放当前安装资产

`META-INF/channels/<channel>/manifest.json`、`bootstrap.sh`、`bootstrap.ps1` 是默认安装入口使用的“当前版本快照”。它们必须与 `versions.json.<channel>` 一致。

原因：默认安装需要快速拿到当前版本脚本和 manifest，但这些资产不是指针本身。

### 3. `releases/<version>/manifest.json` 是显式版本安装入口

`curl ... --version 1.0.18`、`cz-cli update -t 1.0.18` 和 `/install.ps1?version=1.0.18` 都必须先读取 `META-INF/releases/1.0.18/manifest.json`。缺失时返回 out-of-date 提示，不猜测私有路径。

原因：历史版本能否安装取决于当时是否记录了 presigned archive URL。`versions.json` 只说明“这个版本存在过”，不携带下载细节。

### 4. downgrade guard 保护指针和 channel 资产

发布或 promote 发现目标低于当前 `versions.json.<channel>` 时，必须拒绝或跳过 channel promote，并且不得同步 `META-INF/channels/<channel>/*`。

原因：如果只保护 `versions.json` 但已覆盖 channel manifest/bootstrap，会出现默认安装脚本和 API 当前版本不一致。

## Risks / Trade-offs

- [历史版本缺少 release manifest] → 显式安装会失败；需要通过后续回填或重新发布生成 `META-INF/releases/<version>/manifest.json`。
- [部署顺序不一致] → 官网代码先部署但 COS 未迁移时默认安装可能找不到 `channels/<channel>/...`；需要发布脚本先写新路径，官网可在短期内保留只读兼容 fallback，最终移除旧路径。
- [现有测试基于旧路径] → 需要集中更新 release/promote/website route 测试，避免继续断言 `META-INF/stable`。

## Migration Plan

1. 更新发布脚本，让新发布同时写 `META-INF/channels/<channel>/...` 和 `META-INF/releases/<version>/...`，channel 指针只写 `versions.json`。
2. 更新 promote 脚本，让 promote 同步 `releases/<version>` 到 `channels/<channel>` 并更新 `versions.json`。
3. 更新官网读取路径：`/api/stable|nightly` 读 `versions.json`，默认安装读 `channels/<channel>/bootstrap.*`，显式版本读 `releases/<version>/manifest.json`。
4. 更新 CLI update Windows 指定版本路径。
5. 发布新版官网和 CLI，再评估是否需要对 `1.0.18` 等历史版本回填 release manifest。

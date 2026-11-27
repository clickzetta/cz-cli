# 发布渠道与约束

`cz-cli` 区分 **Nightly（预发布）** 与 **Stable（正式版）** 两个发布渠道，由 [.github/workflows/release-cos.yml](../../.github/workflows/release-cos.yml) 执行构建与分发：

- **Nightly 预发布（`dev-vX.Y.Z.<timestamp>`）**：
  - 仅针对已合入 `main` 且对应精确 SHA 的 `cz-test` 通过的提交打轻量 tag 触发。
  - 版本号必须在当前线上 Nightly 通道版本之上严格单调递增，不得直接沿用包内本地开发占位版本。
  - GitHub Release 标记为 prerelease，不更新 `latest`，不发布 npm，也不修改 Stable 指针、默认安装入口或历史制品。
  - 工作流完成后需校验对应版本的 COS manifest、带 `--version` 的安装入口及归档 SHA-256 完整性。
- **Stable 正式版（`vX.Y.Z`）**：
  - 仅由人工正式发版流程触发，包含多平台构建、COS 分发、npm 发布、默认安装器更新与 GitHub Release 正式发布。

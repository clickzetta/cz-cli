# 自维护发布

自动维护只允许 nightly，版本必须为 `dev-vX.Y.Z.<唯一后缀>`。先按当前 nightly 版本选择递增版本；不能从包内开发占位版本猜测对外版本。

只有已合入 `main`、对应 SHA 的 `cz-test` 成功且发布代码包含渠道保护时，才能从控制 checkout 使用：

```sh
bun scripts/maintenance.ts nightly VERSION MERGED_SHA
bun scripts/maintenance.ts nightly VERSION MERGED_SHA --publish
bun scripts/maintenance.ts nightly-status MERGED_SHA
```

首条命令仅预览。工具核对精确 SHA、CI、发布代码和 lineage，再推送一个绑定该 SHA 的 nightly tag，由现有 [release-cos](../../.github/workflows/release-cos.yml) 执行；不再重复 dispatch。发布回执和未知结果留在公共运行目录，先对账再继续。

GitHub release 必须为 prerelease，不能更新 latest；nightly 不发布 npm，不修改 stable 指针、安装入口和历史制品。发布 tag 统一经过该工具，不用全量 tag 推送、直接创建 release 或手工绕过 lineage。现有人工 stable 发布流程另行授权。

工作流成功后继续核对实际版本的 COS manifest、安装入口和主要用户路径；工具提示仍需产物验证时不能直接宣布发布完成。版本或 SHA 已有未知结果时不分配新版本绕过。

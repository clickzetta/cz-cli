# 作业信息

`job profile <job-id>` 使用 Studio 的 `getJobProfile`，请求固定带 `brief=true`，默认展示整理后的基础字段。

- `--raw` 是该子命令的布尔选项，默认关闭；开启后序列化接口返回的对象，不做字段过滤。
- 原始输出默认按 4000 字符上限截断显示；`--no-limit` 关闭该显示限制。
- `--raw --path FILE` 将完整 JSON 写入文件，不受显示截断影响；`--path` 在 raw 分支内处理。
- `--raw` 不会将请求改为 `brief=false`，也不会额外下载响应 URL 指向的 stats 或 plan 文件。响应包含哪些字段由接口决定；调整 raw 或导出字段时须明确兼容性与产品契约。

来源：[命令与请求](../../packages/cz-cli/src/commands/job.ts)、[默认字段整理](../../packages/cz-cli/src/commands/job-profile.ts)、[原始输出与文件导出测试](../../packages/cz-cli/test/job-download-profile-command.test.ts)。

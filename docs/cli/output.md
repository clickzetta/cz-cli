# 输出

cz-cli 的输出同时给人和脚本、Agent 用，格式、错误结构和退出码都是对外契约。用户可见的说明在 [README 的 Output 一节](../../README.md#output)，实现在 [output 模块](../../packages/cz-cli/src/output/index.ts)。

- **成功**：默认 JSON，外层是 `{"data": …}`。`--format` 可选 `json`、`pretty`、`table`、`csv`、`text`、`jsonl`、`toon`；`--field <path>` 只取一个字段。
- **失败**：外层是 `{"error": {"code", "message"}}`，可附带 `ai_message`、`next_steps` 等字段给 Agent 使用。行式格式（`text`、`table`、`csv`、`jsonl`）下失败只输出一行 `ERROR <code>: <message>`。
- **退出码**：`0` 成功，`1` 业务错误，`2` 用法错误（`EXIT_OK`、`EXIT_BIZ_ERROR`、`EXIT_USAGE_ERROR`）。用户中断退出码为 `130`。
- **需要用户批准的写操作**：错误码 `WRITE_NOT_ALLOWED`，`status: "action_required"`，并给出 `next_steps`。见 [Data Agent](data-agent.md#写操作门)。

新增命令或错误时复用 `success`、`error`、`handledError`，不要自己拼 JSON 或直接写 stdout；新增错误码时同步更新调用方会解析的地方（skill 文档、guide）。

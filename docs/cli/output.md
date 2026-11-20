# 输出

cz-cli 的输出同时给人和脚本、Agent 用，格式、错误结构和退出码都是对外契约。用户可见的说明在 [README 的 Output 一节](../../README.md#output)，实现在 [output 模块](../../packages/cz-cli/src/output/index.ts)。

- **成功**：默认 JSON，外层是 `{"data": …}`。`--format` 可选 `json`、`pretty`、`table`、`csv`、`text`、`jsonl`、`toon`；`--field <path>` 只取一个字段。
- **失败**：外层是 `{"error": {"code", "message"}}`，可附带 `ai_message`、`next_steps` 等字段给 Agent 使用。行式格式（`text`、`table`、`csv`、`jsonl`）下失败只输出一行 `ERROR <code>: <message>`。
- **退出码**：`0` 成功，`1` 业务错误，`2` 用法错误（`EXIT_OK`、`EXIT_BIZ_ERROR`、`EXIT_USAGE_ERROR`）。用户中断退出码为 `130`。
- **需要用户批准的写操作**：错误码 `WRITE_NOT_ALLOWED`，`status: "action_required"`，并给出 `next_steps`。见 [Data Agent](data-agent.md#写操作门)。

新增命令或错误时复用 `success`、`error`、`handledError`，不要自己拼 JSON 或直接写 stdout；新增错误码时同步更新调用方会解析的地方（skill 文档、guide）。

## Ad-hoc execution outcomes

`task execute` returns a `data` object alongside an error when submission has started. It contains `task_id`, `submission_status` (`submitted` or `unknown`), `execution_status`, and `run_id` when available. JSON consumers must retain these fields even when the process exits with code 1.

- `EXECUTE_FAILED`: the existing run failed; `data` retains its identity and terminal status.
- `EXECUTE_TIMEOUT`: the CLI stopped waiting; the run can still be active. `data.execution_status` is the last observed status, or `UNKNOWN` if none was read.
- `EXECUTE_STATUS_UNKNOWN`: submission returned a run ID, but a subsequent status read failed. Inspect that run instead of submitting another one.
- `EXECUTE_SUBMISSION_UNKNOWN`: submission failed to return a usable ID, or its request failed. The service may already have created a run. Inspect the task's TEMP runs before taking any further submission action.

`task execute` merges saved manual parameters with explicit command parameters and always submits a parameter object, even when it is empty. The ad-hoc submission transport does not retry requests automatically. A response error cannot establish that a non-idempotent request was never accepted. An end timestamp without an explicit terminal status does not establish successful completion.

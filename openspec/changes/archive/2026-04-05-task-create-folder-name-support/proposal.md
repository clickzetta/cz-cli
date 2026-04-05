## Why

`cz-cli task create --folder` 目前只接受整数 ID，用户和 AI Agent 在不知道 folder ID 的情况下必须先运行 `task folders` 查询，再手动取 ID 拼接命令，体验割裂。支持直接传文件夹名称可以消除这一额外步骤。

## What Changes

- `cz-cli task create --folder` 参数类型从 `int` 改为 `str`，同时接受整数 ID 或文件夹名称字符串
- 当传入值为纯数字时，直接作为 folder ID 使用（向后兼容）
- 当传入值为字符串名称时，自动调用 `list_folders` API 分页搜索，匹配 `dataFolderName` 解析出对应 ID
- 找不到匹配文件夹时，返回 `FOLDER_NOT_FOUND` 错误并提示用户使用 `cz-cli task folders` 查看可用列表
- 新增内部辅助函数 `_resolve_folder_id_by_name`，支持分页遍历所有文件夹

## Capabilities

### New Capabilities

- `task-create-folder-name-resolution`: `task create --folder` 支持按名称自动解析 folder ID，无需用户预先查询

### Modified Capabilities

- `task-management`: `task create` 的 `--folder` 参数行为变更——接受名称字符串并自动解析（原有整数 ID 用法保持不变）

## Impact

- **修改文件**：`cz_cli/commands/task.py`
  - `task_create` 函数签名：`folder_id: int` → `folder: str`
  - Click option 定义：`type=int` → `type=str`，help 文案更新
  - 新增 `_resolve_folder_id_by_name(client, name, fmt) -> int` 辅助函数
- **向后兼容**：整数 ID 用法完全不变，无 breaking change
- **API 依赖**：解析名称时调用 `list_folders` 工具，与现有 `task folders` 命令使用相同接口

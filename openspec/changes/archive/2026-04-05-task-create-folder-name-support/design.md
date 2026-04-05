## Context

`cz-cli task create --folder` 当前只接受整数 ID（Click `type=int`），用户或 AI Agent 必须先执行 `task folders` 拿到 ID 再传参，步骤割裂。改动已在 `cz_cli/commands/task.py` 实现完毕：参数类型改为 `str`，运行时判断是否为纯数字，否则调用 `list_folders` API 分页查找匹配的文件夹名称。

## Goals / Non-Goals

**Goals:**
- `--folder` 同时接受整数 ID 和文件夹名称字符串
- 名称解析支持分页遍历，不受单页数量限制
- 找不到名称时给出明确错误和操作提示
- 整数 ID 用法向后完全兼容

**Non-Goals:**
- 不支持模糊/部分名称匹配（必须精确匹配 `dataFolderName`）
- 不扩展到其他命令（`task list --folder` 等后续单独处理）
- 不缓存 folder 列表（每次解析都实时查询 API）

## Decisions

### 1. 运行时类型判断而非 Click 自定义类型
将参数类型改为 `str`，函数体内用 `folder.lstrip("-").isdigit()` 判断是否为整数，而非实现 Click `ParamType` 子类。

**理由**：改动最小、最直接；Click 自定义类型需要额外的 `convert` 方法和错误处理模板，对单一参数扩展来说过度设计。

### 2. 分页遍历而非单页搜索
`_resolve_folder_id_by_name` 循环调用 `list_folders`（每页 50 条）直至最后一页。

**理由**：目前已有 65+ 个文件夹，默认 page_size=10 可能遗漏目标；分页遍历保证正确性。

### 3. 精确匹配 `dataFolderName`
仅当 `f["dataFolderName"] == name` 完全相等时匹配，不做大小写折叠或前缀匹配。

**理由**：模糊匹配可能返回多个候选，造成歧义；精确匹配行为可预期，与 `task` 命令的 name 解析风格一致。

## Risks / Trade-offs

- **额外 API 调用**：传文件夹名称时会产生 1~N 次 `list_folders` 请求 → 文件夹数量通常有限，延迟可接受；整数 ID 用法不受影响
- **名称唯一性依赖**：若同一根目录下存在同名文件夹，返回第一个匹配项 → 当前 API 在根目录下不允许重名，风险极低
- **嵌套文件夹暂不支持**：当前实现只搜索 `parentFolderId=0`（根目录）的文件夹 → 与现有 `--folder-id` 语义一致，嵌套场景后续按需扩展

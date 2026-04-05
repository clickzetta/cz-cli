## 1. 核心实现

- [x] 1.1 将 `task create --folder` Click option 类型从 `type=int` 改为 `type=str`，并更新 help 文案
- [x] 1.2 新增辅助函数 `_resolve_folder_id_by_name(client, name, fmt) -> int`，支持分页遍历 `list_folders` API 按名称精确匹配文件夹
- [x] 1.3 在 `task_create` 函数体中添加运行时判断：纯数字直接转 `int`，否则调用 `_resolve_folder_id_by_name` 解析

## 2. 错误处理

- [x] 2.1 找不到匹配文件夹时返回 `FOLDER_NOT_FOUND` 错误，并提示用户运行 `cz-cli task folders` 查看可用列表

## 3. 验证

- [x] 3.1 验证整数 ID 用法向后兼容（`--folder 719034` 正常工作）
- [x] 3.2 验证文件夹名称用法正常解析并创建任务（`--folder test_bulkload_100k_20260405` 成功）
- [x] 3.3 确认 `cz-cli task create --help` 显示更新后的参数说明

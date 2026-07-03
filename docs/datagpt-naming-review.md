# DataGPT CLI 命名规范审查报告

## 现有 cz-cli 命名模式（参考基准）

| 模式 | 示例 |
|---|---|
| 简单 CRUD 动词 | `list`, `create`, `describe`, `drop`, `delete`, `update` |
| 资源-名词式子命令 | `datasource catalogs`, `datasource objects` |
| 状态/信息查看 | `profile status`, `runs stats` |
| 获取结果 | `job result`, `runs logs` |
| 操作动词 | `execute`, `deploy`, `undeploy`, `refill`, `rerun`, `stop` |
| 连接测试 | `datasource test` |
| 异步模式 | `sql --sync`（用 flag 控制，不拆分独立命令） |
| 分页 | `--page` / `--page-size` 选项（不拆分独立命令） |
| 别名 | `["detail", "show"]` 数组语法，`["logs", "log"]` |

---

## 审查发现（按严重程度排列）

### 阻断级 — 与现有命令直接冲突

| # | 文档当前写法 | 应改为 | 原因 |
|---|---|---|---|
| 1 | `datasource verify` | `datasource test` | 现有 `datasource test` 已实现连接验证，同一概念应用同一动词。 |
| 2 | `datasource list-databases` | `datasource catalogs` | 现有 `datasource catalogs <datasource>` 使用名词形式。 |
| 3 | `datasource list-tables` | `datasource objects` | 现有 `datasource objects <ds> <catalog>` 已实现该功能。 |
| 4 | `datasource list-columns` | **删除**，用 `datasource describe` | 现有 `datasource describe <ds> <catalog> <object>` 已返回列详情。 |
| 5 | `datasource preview-table` | `datasource preview` | 遵循 `table preview <name>` 模式，仅保留动词。 |
| 6 | `session get-answer` | `session result` | 遵循 `job result` 模式，用名词表示获取输出。 |
| 7 | `session poll-answer` | `session wait` | 遵循 `runs wait <id>` 模式。 |
| 8 | `datasource search` | **删除**，用 `datasource list --search` | 现有 `datasource list` 已支持 `--name` 过滤，加 `--search` 即可。 |
| 9 | `datasource load-async` | `datasource load --async` | 遵循 `sql --sync` 模式，用 flag 控制，不拆命令。 |
| 10 | `metric search` | `metric list` + 过滤选项 | 同 #8。 |

### 高优 — 动词-名词复合形式应改为资源优先

| # | 文档当前写法 | 应改为 | 原因 |
|---|---|---|---|
| 11 | `domain add-table` | `domain table add` | 资源优先模式，table 是被操作的资源。 |
| 12 | `domain remove-table` | `domain table remove` | 同上。 |
| 13 | `domain discover-joins` | `domain joins discover` | 资源优先。 |
| 14 | `domain apply-joins` | `domain joins apply` | 资源优先。 |
| 15 | `domain get-discover-joins-result` | `domain joins result` | 5 个词 → 3 个词，过于冗长。 |
| 16 | `domain add-relation` / `remove-relation` | `domain relation add` / `domain relation remove` | 资源优先。 |
| 17 | `domain list-relations` | `domain relation list` | 资源优先。 |
| 18 | `domain list-relations-by-target` | `domain relation list --target-type X --target-id Y` | 用选项代替复合名称。 |
| 19 | `table set-semantics` | `table semantics set` | 资源优先。 |
| 20 | `table get-semantics` | `table semantics get` | 资源优先。 |
| 21 | `table set-semantics-prop` | `table semantics prop` | 连字符过多。 |
| 22 | `table batch-detail` | `table semantics list` | 对齐 `list` 模式。 |
| 23 | `column set-virtual` | `column virtual set` | 资源优先。 |
| 24 | `column compile-virtual` | `column virtual compile` | 资源优先。 |
| 25 | `column remove-virtual` | `column virtual delete` | 资源优先，且 `remove` → `delete`。 |
| 26 | `column list-virtual` | `column virtual list` | 资源优先。 |
| 27 | `datasource query-tables` | `datasource tables` 或合并到 `objects` | 动词-名词复合形式。 |

### 高优 — `--safe`/`--open`/`--paged` 等模式变体应改用 flag

| # | 文档当前写法 | 应改为 | 原因 |
|---|---|---|---|
| 28 | `session create-safe` | `session create` | 当前 open flow 固定创建 safe session，不再暴露 safe 模式开关。 |
| 29 | `session open` / `open-paged` | `session list --page N --page-size M` | 分页在现有 `datasource list` 中通过选项控制。 |
| 30 | `session run-open` | `session run` | 当前 open flow 固定调用 `/open/text2insight/query`，不再暴露 open 模式开关。 |
| 31 | `session stop-open` | `session stop` | 当前 open flow 固定调用 `/open/text2insight/stop`。 |
| 32 | `metric calculate-async` | `metric calculate --async` | 与 `load --async` 模式一致。 |

### 高优 — 动词选择不一致

| # | 文档当前写法 | 应改为 | 原因 |
|---|---|---|---|
| 33 | `knowledge add` | `knowledge create` | `add` 用于向父资源添加子项。创建独立资源用 `create`（`schema create`、`table create`、`profile create`、`task create`）。 |
| 34 | `knowledge remove` | `knowledge delete` | `remove` 用于从父资源中移除。删除独立资源用 `delete` 或 `drop`（`profile delete`、`schema drop`）。 |
| 35 | `tenant is-allowed` | `tenant status` 或 `tenant allowed` | 遵循 `profile status` / `runs stats` 模式。 |

### 中优 — 结构 / 命名冲突

| # | 问题 | 建议 |
|---|---|---|
| 36 | `datagpt table` 与顶层 `table` 命令冲突 | 用户容易混淆。顶层 `table` 管理数据库表（DESCRIBE、DROP 等），`datagpt table` 做语义配置。建议重命名为 `datagpt semantics`（其子命令就是 `set`/`get` 语义）或 `datagpt dataset`（API 已使用 `--dataset-id`）。 |
| 37 | `datagpt domain delete` vs `schema drop` | `delete` 可以（与 `profile delete` 一致），但应在 DataGPT 内部保持一致，不要混用 `delete` 和 `remove`。 |
| 38 | `answer-builder` 顶层含连字符 | `ai-guide` 已使用连字符，此处一致。但名称偏长，可考虑 `builder` 或 `answer`。 |
| 39 | `knowledge maintain` | 文档中语义不明。如果是更新操作，应叫 `knowledge update`。 |

---

## 总结

文档中的命名问题可归纳为四类：

1. **同一概念、不同动词** — 应使用 cz-cli 已有动词：`verify`→`test`、`get-answer`→`result`、`poll-answer`→`wait`、`add`→`create`、`remove`→`delete`

2. **动词-名词复合形式** — 应重组为资源优先的子命令结构：`add-table`→`table add`、`set-semantics`→`semantics set`、`set-virtual`→`virtual set`、`discover-joins`→`joins discover`、`list-relations`→`relation list`

3. **模式变体拆分独立命令** — 应合并或内聚到固定 open flow：`*-async`→`--async`、`*-paged`→`--page`；session 的 safe/open 变体由当前 open API 路径固定承载，不再暴露为 CLI flag

4. **冗余命令** — 应合并到已有模式：`search`→`list --filter`、`list-columns`→`describe`、`list-tables`→`objects`、`list-databases`→`catalogs`

老板给出的 `ask`→`run` 示例正是此类修改的典型代表——同一概念在 cz-cli 中已有对应动词时，优先沿用。

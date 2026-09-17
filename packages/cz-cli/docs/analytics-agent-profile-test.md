# Analytics Agent Profile 手工测试指南

## 目的

使用一个没有历史上下文的新对话 session，通过本地已有 profile 调用真实 Analytics Agent 服务，模拟普通用户完成任务。

这不是本地测试套件执行指南。新 session 不应运行 `bun test`、`bun typecheck` 或阅读现有测试代码。它应把 CLI 当作黑盒工具，通过 `--help`、只读查询和受控写入完成任务。

本轮重点验证：

1. `domain joins apply` 不再猜测或错配 dataset ID 与 table name。
2. `session list` 始终显式携带 `--domain-id`。
3. `table semantics set` 使用 `--body-file` 传递长文本和 JSON。
4. Answer Builder 使用 `--content-file`、`--sql-file` 和可选的 `--body-file`。
5. `table update` 同时显式携带 dataset ID 与 domain ID。

## 测试边界

- 优先使用 `uat`；也可以使用明确允许写入的 `dev-lh` 或 `datagpt-test`。
- 不要使用 `prod`，除非测试负责人明确授权。
- 必须先识别名称明显用于测试的 domain/dataset。不得修改业务 domain。
- `session list`、domain/detail/join list、semantics list/get 和 Answer Builder validate 可以直接执行。
- `table semantics set`、`table update` 和 `joins apply` 会写入远端状态，只能用于明确的测试对象。
- 任何更新前都要读取并保存原值，测试后恢复，并再次读取确认。
- 如果没有可安全写入的对象，跳过写操作并报告阻塞，不要自行创建或猜测目标。
- 不输出 profile 密码、token、PAT 或完整认证配置。

## 运行当前源码

本轮改动尚未构建到全局安装的 `cz-cli`。新 session 必须从当前工作区运行源码：

```bash
cd /Users/xiaoyuchen/working/cz-cli/packages/cz-cli
bun src/main.ts <command> --profile uat
```

不要直接调用全局 `cz-cli`，否则可能测试到旧版本。

## 新 Session 启动提示词

将下面内容作为新对话的第一条消息。它只规定环境和安全边界，不告诉 agent 每个功能的标准答案。

```text
你在 /Users/xiaoyuchen/working/cz-cli 工作区中测试 cz-cli 的 Analytics Agent 命令。

请把 CLI 当作黑盒使用，不阅读源码或测试代码，也不要运行 bun test、bun typecheck 等本地测试套件。所有验证必须通过本地已有 profile 调用真实服务完成。

必须从当前源码运行命令：
cd /Users/xiaoyuchen/working/cz-cli/packages/cz-cli
bun src/main.ts <command> --profile uat

先用只读命令确认 profile 和可用测试数据。优先使用 uat，只能操作名称明显属于测试用途的 domain/dataset；禁止使用 prod。任何远端写操作前必须读取并记录原值，完成后恢复并验证。找不到安全测试对象时停止该写操作并说明原因，不要猜测 ID、表名或字段名。不要输出密码、token 或 PAT。

每个任务请记录：实际执行的命令、关键响应、是否符合预期、发现的问题、是否产生远端修改以及是否已恢复。失败后先根据 help 和服务端错误修正原因，不要盲目重复相同请求。
```

## 场景一：Session List 的 Domain Scope

向新 session 发送下面这条自然语言请求，不要补充命令格式：

```text
请使用 uat profile 找一个测试分析域，列出这个域里的 Analytics Agent sessions。告诉我你选择了哪个 domain，以及为什么。
```

验收标准：

- 先查询 domain，而不是猜 domain ID。
- 最终调用 `analytics-agent session list` 时显式传入 `--domain-id`。
- 不从 profile、workspace 或其他 session 推断 domain ID。
- 不因为第一次结果为空就省略 domain scope 重试。

参考形态，不要提前发给新 session：

```bash
bun src/main.ts analytics-agent domain list --profile uat
bun src/main.ts analytics-agent session list --domain-id <DOMAIN_ID> --profile uat
```

## 场景二：Join 映射

先执行只读测试。向新 session 发送：

```text
请检查 uat profile 中一个含多张表的测试分析域，列出它的表和现有 join，并判断每个 join 两侧的 dataset ID 与 table name 是否正确对应。不要修改 join。
```

验收标准：

- 使用 `domain detail <id> --with-tables` 获取完整 dataset 映射。
- 使用 `domain joins list --domain-id <id>` 获取现有 join。
- 将 `(datasetId, tableName)` 和 `(joinDatasetId, joinTableName)` 分别作为不可拆分的配对核对。
- `tableName` 必须逐字来自 API，不自行添加 `v_gpt_`，不使用 `physicalTable` 或 `displayName`。
- 不因 `joins list` 为空而编造 join。

只有准备了可丢弃的测试 domain 时，才追加下面的写入任务：

```text
请在这个可丢弃测试域中发现 join，等待发现任务成功后选择一条结果应用，并再次读取确认。只能使用 API 返回的完整 join 记录，不得猜测或拼装 ID、table name、column 或 relation。
```

写入验收标准：

- 按 `discover -> result -> apply -> list` 顺序执行。
- 等待 result 的 `status=SUCCESS`。
- apply 前用 domain tables 再次验证两侧 ID/name 映射。
- 如果任一映射无法确认，停止 apply。

## 场景三：Table Semantics 长文本

该场景会修改远端字段语义。只对测试 dataset 执行。

向新 session 发送：

```text
请在 uat 的测试分析域中选择一个测试 dataset 和普通字段，把该字段的 alias、中文长描述和 dimension 语义更新后再读取验证。描述中要包含空格、中文引号和换行，避免把长 JSON 或长文本直接塞进命令参数。完成后恢复原值并再次验证。
```

验收标准：

- 先通过 domain detail 和 semantics list/get 找到真实 dataset ID、attr ID。
- 修改前保存原始语义。
- 使用临时 UTF-8 JSON 文件和 `--body-file`，不以内联 `--alias`、`--description` 或 `--body` 承载长文本。
- JSON 文件应是对象，例如：

```json
{
  "alias": ["会员", "高价值客户"],
  "description": "这是包含空格和中文引号“说明”的长描述。\n第二行用于验证多行文本。",
  "dimension": true
}
```

- 更新后通过 `semantics get` 验证服务端值。
- 使用另一个恢复 JSON 文件还原原值，并再次读取确认。
- 临时文件中不得包含认证信息。

参考命令形态：

```bash
bun src/main.ts analytics-agent table semantics list <DATASET_ID> --profile uat
bun src/main.ts analytics-agent table semantics get <DATASET_ID> <ATTR_ID> --profile uat
bun src/main.ts analytics-agent table semantics set <DATASET_ID> <ATTR_ID> \
  --body-file /tmp/cz-cli-semantics.json --profile uat
```

## 场景四：Answer Builder 文件输入

`validate` 是首选验证路径，不需要创建 Answer Builder。

向新 session 发送：

```text
请使用 uat profile 和一个测试分析域，为真实测试表准备一个 Answer Builder 定义并执行 validate。DSL 和 SQL 都应从文件读取；SQL 必须是多行，并至少包含一个 ${...} 交互参数。不要创建 Answer Builder，只做 validate。
```

验收标准：

- 先读取 domain/table/column 信息，不猜表名或列名。
- DSL 写入 UTF-8 JSON 文件，通过 `--content-file` 传入。
- SQL 写入单独文件，通过 `--sql-file` 传入。
- `${...}` 占位符在发送给服务端时保持原样，没有被 shell 展开为空。
- 每个 SQL 占位符有对应的 `chartParams` 项。
- `outputColumns[].metricName` 非空，并在目标 domain 内避免使用明显会冲突的通用名称。
- 先执行 validate，不执行 create/update。

参考命令形态：

```bash
bun src/main.ts analytics-agent answer-builder validate \
  --analysis-name profile-file-input-check \
  --datasource-id <DATASOURCE_ID> \
  --domain-ids '[<DOMAIN_ID>]' \
  --content-file /tmp/cz-cli-answer-builder-content.json \
  --sql-file /tmp/cz-cli-answer-builder-query.sql \
  --profile uat
```

如需验证 `--body-file`，可以把非关键基础字段放入 JSON 文件；命令行上的 `analysis-name`、datasource 和 domain scope 仍应显式传入。

以下组合必须被视为用法错误，不应发出远端请求：

- `--content` 与 `--content-file`
- `--sql` 与 `--sql-file`
- `--body` 与 `--body-file`

## 场景五：Table Update 的双重作用域

该场景会修改远端 dataset，只对测试对象执行。

向新 session 发送：

```text
请把 uat 中一个测试 dataset 的显示名称临时改成带 profile-check 后缀的名称，读取确认后恢复。请确保更新的是目标 domain 中的那个 dataset。
```

验收标准：

- 通过 `domain detail <id> --with-tables` 获取 dataset ID 和所属 domain ID。
- `table update` 同时传 `--dataset-id` 和 `--domain-id`。
- 不从 dataset ID 猜 domain ID。
- 修改前记录原始 display name，结束后恢复并验证。

## 建议执行顺序

1. Session list，只读。
2. Join 映射核对，只读。
3. Answer Builder validate，只读/干运行。
4. Table semantics set，受控写入并恢复。
5. Table update，受控写入并恢复。
6. Join apply，仅在专用可丢弃 domain 中执行。

## 测试报告模板

```text
Profile:
Domain ID / name:
Dataset ID / tableName:

Scenario:
Commands executed:
Observed response:
Result: PASS / FAIL / BLOCKED

Remote state changed: yes / no
Original value recorded: yes / no / not applicable
State restored and verified: yes / no / not applicable

Unexpected retries or guessed values:
CLI/help issue found:
Service issue found:
Notes:
```

## 判定重点

这组测试不只看最终请求是否成功，还要观察新 session 的行为：

- 是否主动读取 help 和真实资源，而不是依赖先验猜参数。
- 是否在所有 domain-scoped 操作中保留明确作用域。
- 是否面对长 JSON、中文、引号、多行文本和 `${...}` 时主动选择文件输入。
- 是否把 API 返回的 ID/name 组合当作权威记录。
- 是否在错误后修正根因，而不是重复同一个失败请求。
- 是否在写操作后完成恢复和二次验证。

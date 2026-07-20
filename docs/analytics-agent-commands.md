# Analytics Agent 命令说明

本文档汇总 `cz-cli analytics-agent` 下的命令面，来源于 `packages/cz-cli/src/commands/analytics-agent.ts` 与 `cz-cli analytics-agent --help`。

## 通用用法

```bash
cz-cli [global options] analytics-agent <group> <command> [args] [options]
```

- `<...>` 表示必填位置参数，`[...]` 表示可选位置参数。
- 支持在任意子命令后追加 `--help` 查看最新参数说明。
- 常用全局参数：`--profile/-p`、`--format`、`--field`、`--debug/-d`。
- `--format` 默认是 `json`，可选 `json`、`pretty`、`table`、`csv`、`text`、`jsonl`、`toon`。
- 可重复参数（例如 `--domain-id`、`--alias`、`--sample-question`）需要重复传入，不要传 JSON 数组字符串。

## 命令总览

| 命令组 | 用途 |
| --- | --- |
| `datasource` | 查找数据源、浏览/搜索/查看表、加载表为 dataset |
| `domain` | 管理业务域、域提示词、绑定表、手动维护 join |
| `table semantics` | 管理数据集字段语义 |
| `column virtual` | 管理数据集虚拟列 |
| `metric` | 管理简单指标 |
| `answer-builder` | 管理 answer builder |
| `knowledge` | 管理结构化知识、知识空间、文件夹、文件 |
| `service` | 检查 Analytics Agent 服务能力 |
| `session` | 管理 text2insight 会话和问答 |

## 数据源命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent datasource list` | 列出数据源 | `--name`、`--with-detail` |
| `analytics-agent datasource browse <datasource-id>` | 浏览数据源子节点 | `--workspace`、`--schema`、`--name`、`--page-num`、`--page-size` |
| `analytics-agent datasource table search <datasource-id> <keyword>` | 按 scope 搜索数据源中的表 | `--workspace`、`--schema`、`--page-num`、`--page-size` |
| `analytics-agent datasource table show <datasource-id>` | 查看表字段，可选预览 | `--workspace`、`--schema`、`--table`、`--preview`、`--preview-size` |
| `analytics-agent datasource table load <datasource-id>` | 将表加载为 dataset，可选绑定 domain | `--workspace`、`--schema`、`--table`、`--domain-id` |

示例：

```bash
cz-cli analytics-agent datasource list --with-detail --format table
cz-cli analytics-agent datasource browse 12 --workspace w --schema s
cz-cli analytics-agent datasource table search 12 orders --workspace w --schema s
cz-cli analytics-agent datasource table show 12 --workspace w --schema s --table orders --preview
cz-cli analytics-agent datasource table load 12 --workspace w --schema s --table orders --domain-id 195
```

## 业务域命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent domain list` | 列出业务域 | `--with-tables` |
| `analytics-agent domain create` | 创建业务域 | `--name`、`--description`、`--datasource-id`、`--sample-question` |
| `analytics-agent domain update <domain-id>` | 更新业务域 | `--name`、`--description`、`--datasource-id`、`--sample-question` |
| `analytics-agent domain detail <domain-id>` | 查看业务域详情 | `--with-tables` |
| `analytics-agent domain delete <domain-id>` | 删除业务域 | `<domain-id>` |
| `analytics-agent domain prompt get <domain-id>` | 获取业务域自定义提示词 | `<domain-id>` |
| `analytics-agent domain prompt set <domain-id>` | 设置业务域自定义提示词 | `--prompt` |
| `analytics-agent domain prompt clear <domain-id>` | 清除业务域自定义提示词 | `<domain-id>` |
| `analytics-agent domain table add <domain-id>` | 向业务域添加数据源表 | `--datasource-id`、`--workspace`、`--schema`、`--table` |
| `analytics-agent domain table remove <domain-id> <table-id>` | 从业务域移除表 | `<domain-id>`、`<table-id>` |
| `analytics-agent domain join list <domain-id>` | 列出业务域 join 关系 | `--dataset-id`、`--join-dataset-id`、`--keyword` |
| `analytics-agent domain join get <domain-id> <join-id>` | 查看 join 关系详情 | `<domain-id>`、`<join-id>` |
| `analytics-agent domain join create <domain-id>` | 创建 join 关系 | `--dataset-id`、`--attr-code`、`--join-dataset-id`、`--join-attr-code`、`--relation` |
| `analytics-agent domain join update <domain-id> <join-id>` | 更新 join 关系 | 同 `create`，另需 `<join-id>` |
| `analytics-agent domain join delete <domain-id> <join-id>` | 删除 join 关系 | `<domain-id>`、`<join-id>` |

示例：

```bash
cz-cli analytics-agent domain create --name sales --datasource-id 12 --sample-question "本月销售额是多少？"
cz-cli analytics-agent domain table add 195 --datasource-id 12 --workspace w --schema s --table orders
cz-cli analytics-agent domain join create 195 --dataset-id 1773 --attr-code customer_id --join-dataset-id 1774 --join-attr-code id --relation n:1
```

## 表语义与虚拟列命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent table semantics list <dataset-id>` | 列出数据集所有字段语义 | `<dataset-id>` |
| `analytics-agent table semantics get <dataset-id> <attr-id>` | 查看单个字段语义 | `<dataset-id>`、`<attr-id>` |
| `analytics-agent table semantics set <dataset-id> <attr-id>` | 更新字段语义 | `--alias`、`--description`、`--semantic-type`、`--intended-type`、`--hidden`、`--dimension`、`--index`、`--dict-code` |
| `analytics-agent table semantics prop <dataset-id> <attr-id> <property> <value>` | 更新单个字段语义属性 | `<property>`、`<value>`，`<value>` 支持 JSON 值 |
| `analytics-agent column virtual list <dataset-id>` | 列出数据集虚拟列 | `<dataset-id>` |
| `analytics-agent column virtual compile <dataset-id>` | 编译虚拟列表达式但不保存 | `--name`、`--type`、`--expression` |
| `analytics-agent column virtual set <dataset-id>` | 创建并保存虚拟列 | `--name`、`--type`、`--expression` |
| `analytics-agent column virtual delete <dataset-id> <attr-id>` | 删除虚拟列 | `<dataset-id>`、`<attr-id>` |

示例：

```bash
cz-cli analytics-agent table semantics set 195 31 --alias "销售额" --dimension false
cz-cli analytics-agent column virtual compile 195 --name profit_rate --type double --expression "profit / amount"
cz-cli analytics-agent column virtual set 195 --name profit_rate --type double --expression "profit / amount"
```

## 指标命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent metric list` | 按业务域列出指标 | `--domain-id`、`--datasource-id`、`--table-name`、`--page-num`、`--page-size` |
| `analytics-agent metric create` | 创建简单指标 | `--domain-id`、`--datasource-id`、`--table-name`、`--name`、`--expression`、`--alias`、`--description` |
| `analytics-agent metric update <metric-id>` | 更新指标 | 同 `create`，另需 `<metric-id>` |
| `analytics-agent metric detail <metric-id>` | 查看指标详情 | `<metric-id>` |
| `analytics-agent metric validate` | 校验指标定义 | 同 `create` |
| `analytics-agent metric enable <metric-id>` | 启用指标 | `<metric-id>` |
| `analytics-agent metric disable <metric-id>` | 禁用指标 | `<metric-id>` |
| `analytics-agent metric delete <metric-id>` | 删除指标 | `<metric-id>` |

示例：

```bash
cz-cli analytics-agent metric list --domain-id 195 --format table
cz-cli analytics-agent metric validate --domain-id 195 --datasource-id 12 --table-name orders --name order_count --expression "count(1)"
cz-cli analytics-agent metric create --domain-id 195 --datasource-id 12 --table-name orders --name gmv --expression "sum(amount)"
```

## Answer Builder 命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent answer-builder create` | 创建 answer builder | `--analysis-name`、`--analysis-desc`、`--datasource-id`、`--domain-id`、`--content` |
| `analytics-agent answer-builder update <analysis-id>` | 更新 answer builder | 同 `create`，另需 `<analysis-id>` |
| `analytics-agent answer-builder enable <analysis-id>` | 启用 answer builder | `<analysis-id>` |
| `analytics-agent answer-builder disable <analysis-id>` | 禁用 answer builder | `<analysis-id>` |
| `analytics-agent answer-builder delete <analysis-id>` | 删除 answer builder | `<analysis-id>` |
| `analytics-agent answer-builder detail <analysis-id>` | 查看 answer builder 详情 | `<analysis-id>` |
| `analytics-agent answer-builder list` | 列出 answer builder | `--domain-id`、`--datasource-id`、`--page-num`、`--page-size` |
| `analytics-agent answer-builder validate` | 校验 answer builder 定义 | `--analysis-name`、`--analysis-desc`、`--datasource-id`、`--domain-id`、`--content` |

示例：

```bash
cz-cli analytics-agent answer-builder list --domain-id 195 --format table
cz-cli analytics-agent answer-builder validate --analysis-name funnel --datasource-id 12 --domain-id 195 --content '{"steps":[]}'
```

## 知识命令

### 结构化知识

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent knowledge list` | 列出结构化知识 | `--keyword`、`--domain-id`、`--type text\|dictionary`、`--page-num`、`--page-size` |
| `analytics-agent knowledge get <knowledge-id>` | 查看结构化知识详情 | `<knowledge-id>` |
| `analytics-agent knowledge create` | 创建结构化知识 | `--alias`、`--content`、`--file`、`--dictionary`、`--type text\|dictionary`、`--domain-id` |
| `analytics-agent knowledge update <knowledge-id>` | 更新结构化知识 | `--alias`、`--content`、`--dictionary`、`--type text\|dictionary`、`--domain-id` |
| `analytics-agent knowledge delete <knowledge-id>` | 删除结构化知识 | `<knowledge-id>` |

### 知识空间与节点绑定

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent knowledge space list` | 列出知识空间 | `--domain-id` |
| `analytics-agent knowledge space create` | 创建知识空间 | `--name`、`--description`、`--ocr-model-identifier` |
| `analytics-agent knowledge space rename <space-id>` | 重命名知识空间 | `--name` |
| `analytics-agent knowledge space delete <space-id>` | 删除知识空间 | `<space-id>` |
| `analytics-agent knowledge node bind-domain <space-id> <node-id>` | 设置知识节点直接绑定的业务域 | 重复 `--domain-id` |
| `analytics-agent knowledge node unbind-domain <space-id> <node-id>` | 移除知识节点直接绑定的业务域 | 重复 `--domain-id` |

### 知识文件夹

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent knowledge folder list <space-id>` | 列出文件夹子节点 | `--parent-id`、`--domain-id` |
| `analytics-agent knowledge folder create <space-id>` | 创建文件夹 | `--parent-id`、`--name` |
| `analytics-agent knowledge folder by-path <space-id>` | 按远端路径查找文件夹 | `--path` |
| `analytics-agent knowledge folder search <space-id>` | 按名称搜索文件夹 | `--keyword`、`--page-num`、`--page-size` |
| `analytics-agent knowledge folder sort <space-id>` | 更新文件夹子节点顺序 | 重复 `--node-id`、`--parent-id` |
| `analytics-agent knowledge folder delete <space-id> <node-id>` | 删除文件夹节点 | `<space-id>`、`<node-id>` |
| `analytics-agent knowledge folder rename <space-id> <node-id>` | 重命名文件夹节点 | `--name` |
| `analytics-agent knowledge folder move <space-id> <node-id>` | 移动文件夹节点 | `--parent-id` |
| `analytics-agent knowledge folder copy <space-id> <node-id>` | 复制文件夹节点 | `--parent-id` |

### 知识文件

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent knowledge file list <space-id>` | 列出文件节点 | `--parent-id`、`--domain-id` |
| `analytics-agent knowledge file get <space-id> <node-id>` | 读取知识文件 | `--offset-line`、`--limit-line` |
| `analytics-agent knowledge file delete <space-id> <node-id>` | 删除文件节点 | `<space-id>`、`<node-id>` |
| `analytics-agent knowledge file rename <space-id> <node-id>` | 重命名文件节点 | `--name` |
| `analytics-agent knowledge file move <space-id> <node-id>` | 移动文件节点 | `--parent-id` |
| `analytics-agent knowledge file copy <space-id> <node-id>` | 复制文件节点 | `--parent-id` |
| `analytics-agent knowledge file upload <space-id> <local-file>` | 上传本地文件到知识空间 | `--target-path`、`--name`、`--domain-id` |
| `analytics-agent knowledge file by-path <space-id>` | 按远端路径查找文件 | `--path` |
| `analytics-agent knowledge file search <space-id>` | 按名称搜索文件 | `--keyword`、`--page-num`、`--page-size` |

示例：

```bash
cz-cli analytics-agent knowledge create --alias "指标口径" --content "GMV = sum(amount)" --domain-id 195
cz-cli analytics-agent knowledge space create --name "销售知识库"
cz-cli analytics-agent knowledge file upload 1 ./manual.md --target-path /sales --domain-id 195
```

## 服务与会话命令

| 命令 | 说明 | 关键参数 |
| --- | --- | --- |
| `analytics-agent service enabled` | 检查当前 tenant 是否启用 Analytics Agent | 无 |
| `analytics-agent session list` | 列出 text2insight 会话 | `--domain-id`、`--source-type`、`--source-id` |
| `analytics-agent session create` | 创建安全 text2insight 会话 | `--domain-id`、`--title`、`--source-type`、`--source-id` |
| `analytics-agent session run` | 发起问题并等待结果 | `--domain-id`、`--session-id`、`--msg`、`--model-name`、`--interval-ms`、`--timeout-ms`、`--summary` |
| `analytics-agent session result <question-id>` | 查询问题结果 | `--wait`、`--interval-ms`、`--timeout-ms` |
| `analytics-agent session stop [session-id] [question-id]` | 停止运行中的问题 | `[session-id]`、`[question-id]` |

示例：

```bash
cz-cli analytics-agent service enabled
cz-cli analytics-agent session create --domain-id 195 --title "销售分析"
cz-cli analytics-agent session run --domain-id 195 --msg "上周销售额是多少？" --summary
cz-cli analytics-agent session result 123 --wait --interval-ms 1000 --timeout-ms 60000
```

## 常见注意事项

- 分层数据源使用 `--workspace`、`--schema` 定位 scope；CLI 会合成服务端需要的内部 path。
- `domain join` 是手动 CRUD；join 发现不再作为 CLI 主路径命令暴露。
- `knowledge create --type dictionary` 必须提供 `--dictionary`；普通文本知识需要 `--content` 或 `--file`。
- `session run` 当前要求 `--domain-id`；省略 `--session-id` 时会自动创建新 session。

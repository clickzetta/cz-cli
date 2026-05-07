# 错误特征模式配置

用于错误分类的关键字匹配规则。

---

## 1. 数据集成错误 (INTEGRATION)

数据同步、数据集成任务的错误。

### 1.1 源端错误 (SOURCE)

数据源连接或读取问题。

| 特征关键字 |
|-----------|
| `connection failed` |
| `source permission denied` |
| `source table not found` |
| `cannot connect to source` |
| `source authentication failed` |
| `read timeout` |

### 1.2 传输错误 (TRANSFER)

数据传输过程中的问题。

| 特征关键字 |
|-----------|
| `network error` |
| `transfer timeout` |
| `channel error` |
| `connection reset` |
| `broken pipe` |

### 1.3 目标端错误 (TARGET)

数据写入目标的问题。

| 特征关键字 |
|-----------|
| `write failed` |
| `target conflict` |
| `target permission denied` |
| `duplicate key` |
| `target table not found` |

---

## 2. SQL 执行错误 (SQL)

SQL 任务执行过程中的错误。

### 2.1 语法错误 (SYNTAX)

SQL 语法不正确。

| 特征关键字 |
|-----------|
| `syntax error` |
| `unexpected token` |
| `parse error` |
| `missing keyword` |
| `invalid identifier` |

### 2.2 语义错误 (SEMANTIC)

SQL 语义问题，如对象不存在。

| 特征关键字 |
|-----------|
| `table not found` |
| `column not found` |
| `type mismatch` |
| `ambiguous column` |
| `unknown column` |
| `relation does not exist` |

### 2.3 资源错误 (RESOURCE)

计算资源不足或超限。**需要获取 job_history 进一步分析。**

| 特征关键字 |
|-----------|
| `stage` |
| `out of memory` |
| `partition too large` |
| `slot` |
| `memory exceeded` |
| `disk space` |
| `timeout` |

### 2.4 权限错误 (PERMISSION)

用户权限不足。

| 特征关键字 |
|-----------|
| `permission denied` |
| `access denied` |
| `unauthorized` |
| `insufficient privileges` |
| `no permission` |

---

## 3. 调度错误 (SCHEDULING)

任务调度相关的错误。

### 3.1 依赖错误 (DEPENDENCY)

上游任务依赖问题。**诊断时调用 `get_task_run_dependencies`。**

| 特征关键字 |
|-----------|
| `waiting for upstream` |
| `dependency failed` |
| `upstream timeout` |
| `upstream not ready` |
| `blocked by dependency` |

### 3.2 配置错误 (CONFIG)

任务配置问题。**诊断时调用 `get_task_configuration_detail`。**

| 特征关键字 |
|-----------|
| `kill` |
| `timeout exceeded` |
| `parameter error` |
| `cron invalid` |
| `invalid configuration` |
| `missing parameter` |

### 3.3 资源错误 (RESOURCE)

调度资源不足。

| 特征关键字 |
|-----------|
| `vc unavailable` |
| `queue full` |
| `resource exhausted` |
| `no available slot` |
| `cluster busy` |

---

## 4. 数据质量错误 (DATA_QUALITY)

DQC 数据质量校验失败。

### 4.1 数量异常 (QUANTITY)

数据量不符合预期。

| 特征关键字 |
|-----------|
| `row count` |
| `empty result` |
| `count mismatch` |
| `zero rows` |
| `unexpected count` |

### 4.2 内容异常 (CONTENT)

数据内容问题。

| 特征关键字 |
|-----------|
| `duplicate` |
| `null value` |
| `format error` |
| `invalid value` |
| `data corruption` |

### 4.3 一致性异常 (CONSISTENCY)

数据一致性问题。

| 特征关键字 |
|-----------|
| `mismatch` |
| `inconsistent` |
| `checksum failed` |
| `data drift` |
| `schema mismatch` |

---

## 分类优先级

当多个类别匹配时，按以下优先顺序判断：

1. SQL
2. INTEGRATION
3. SCHEDULING
4. DATA_QUALITY
5. OTHER

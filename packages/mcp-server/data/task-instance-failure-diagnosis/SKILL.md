---
name: task-instance-failure-diagnosis
description: When a task instance (task run) encounters an exception (including not started, execution failure, running too long, etc.), classify the error according to this document, execute the corresponding diagnosis strategy based on the error type, and provide a solution.
---

# Task Instance Failure Diagnosis Skill

## 触发条件

当满足以下任一条件时，使用本 Skill：

- 用户报告任务实例执行失败
- 用户询问任务为什么没有运行/卡住
- 用户提供了任务 ID 或实例 ID 并询问错误原因
- 用户描述了任务运行异常的现象（超时、报错、未开始等）

## 可用工具

诊断过程中可使用以下工具获取信息：

| 工具名称 | 用途 | 使用场景 |
|---------|------|----------|
| `get_task_detail` | 获取任务详情 | 了解任务基本配置和类型 |
| `get_task_instance_detail` | 获取任务实例详情 | 获取具体执行实例的状态和错误信息 |
| `get_execution_log` | 获取执行日志 | 获取详细的错误日志和堆栈信息 |
| `list_task_run` | 列出任务运行记录 | 查看历史运行情况，判断是否偶发 |
| `list_executions` | 列出任务执行详情 | 查看多次执行的对比 |
| `get_task_run_stats` | 获取任务运行统计 | 分析运行时长趋势 |
| `get_task_run_dependencies` | 获取任务运行依赖关系 | 诊断依赖问题时使用 |
| `get_published_task_dependencies` | 获取已发布任务依赖关系 | 分析依赖链路 |
| `get_task_configuration_detail` | 获取任务配置详情 | 检查任务配置是否正确 |

## 诊断流程

```
Step 1: 收集错误信息（调用工具）
    ↓
Step 2: 错误分类
    ↓
Step 3: 执行对应诊断策略
    ↓
Step 4: 生成解决方案
    ↓
Step 5: 输出诊断报告
```

---

## Step 1: 收集错误信息

### 1.1 基础信息收集（必须）

```
1. 调用 get_task_detail(task_id) 获取任务基本信息（非必需步骤）
   → 确定任务类型：SQL / Shell / Python / 多表实时同步 / 离线同步 

2. 调用 get_task_instance_detail(instance_id) 获取实例详情
   → 获取实例状态、开始时间、结束时间、错误码

3. 调用 get_execution_log(instance_id) 获取执行日志
   → 获取详细错误信息和堆栈
```

### 1.2 扩展信息收集（按需）

| 场景 | 需要调用的工具 |
|------|---------------|
| 疑似依赖问题 | `get_task_run_dependencies(instance_id)` |
| 需要分析历史 | `list_task_run(task_id)` |
| 检查配置问题 | `get_task_configuration_detail(task_id)` |
| 分析运行趋势 | `get_task_run_stats(task_id)` |

---

## Step 2: 错误分类

根据错误信息的特征，将错误分为以下类别：

### 2.1 数据集成错误 (INTEGRATION)

**识别特征**：任务类型为数据同步/数据集成

| 子类型 | 特征关键字 |
|--------|-----------|
| 源端错误 (SOURCE) | `connection failed`, `source permission denied`, `source table not found` |
| 传输错误 (TRANSFER) | `network error`, `transfer timeout`, `channel error` |
| 目标端错误 (TARGET) | `write failed`, `target conflict`, `target permission denied` |

### 2.2 SQL 执行错误 (SQL)

**识别特征**：任务类型为 SQL 任务，或错误信息包含 SQL 相关内容

| 子类型 | 特征关键字 |
|--------|-----------|
| 语法错误 (SYNTAX) | `syntax error`, `unexpected token`, `parse error` |
| 语义错误 (SEMANTIC) | `table not found`, `column not found`, `type mismatch`, `ambiguous` |
| 资源错误 (RESOURCE) | `stage`, `out of memory`, `partition too large`, `slot` |
| 权限错误 (PERMISSION) | `permission denied`, `access denied`, `unauthorized` |

### 2.3 调度错误 (SCHEDULING)

**识别特征**：任务未开始执行，或与调度相关

| 子类型 | 特征关键字 |
|--------|-----------|
| 依赖错误 (DEPENDENCY) | `waiting for upstream`, `dependency failed`, `upstream timeout` |
| 配置错误 (CONFIG) | `kill`, `timeout exceeded`, `parameter error`, `cron invalid` |
| 资源错误 (RESOURCE) | `vc unavailable`, `queue full`, `resource exhausted`, `no available slot` |

### 2.4 数据质量错误 (DATA_QUALITY)

**识别特征**：任务类型为 DQC，或错误信息包含质量校验相关内容

| 子类型 | 特征关键字 |
|--------|-----------|
| 数量异常 (QUANTITY) | `row count`, `empty result`, `count mismatch` |
| 内容异常 (CONTENT) | `duplicate`, `null value`, `format error` |
| 一致性异常 (CONSISTENCY) | `mismatch`, `inconsistent`, `checksum failed` |

### 2.5 其他错误 (OTHER)

如果无法匹配以上任何类别，归类为 OTHER，需要进一步分析。

---

## Step 3: 执行对应诊断策略

### 3.1 数据集成错误诊断

```
1. 调用 get_task_detail 确定集成类型（离线同步 / 实时同步）
2. 调用 get_execution_log 获取详细错误
3. 根据子类型定位问题端：
   - SOURCE: 检查源端连接、权限、表是否存在
   - TRANSFER: 检查网络状态、传输配置
   - TARGET: 检查目标端权限、冲突处理策略
   - dataType：字段类型错误，可直接给出结论：直接提示字段错误查看目标表的字段是否正确。
4. 调用 get_task_configuration_detail 检查配置
5. 生成针对性解决方案
```

### 3.2 SQL 执行错误诊断

```
1. 调用 get_execution_log 获取完整错误日志
2. 判断错误子类型：
   - SYNTAX/SEMANTIC: 
     * 分析 SQL 语句，定位具体错误位置
     * 参考 reference/error_patterns.yaml 中的模式
   - RESOURCE: 
     * 如果包含 "stage" 关键字，需要分析 job history
     * 调用 get_task_run_stats 分析资源使用趋势
   - PERMISSION: 
     * 检查用户权限配置
3. 生成 SQL 修改建议或资源优化建议
```

### 3.3 调度错误诊断

```
1. 根据子类型执行诊断：
   - DEPENDENCY: 
     * 调用 get_task_run_dependencies 获取依赖关系
     * 逐个检查上游任务状态
     * 找到失败的根因任务
   - CONFIG:
     * 调用 get_task_configuration_detail 检查任务配置
     * 检查超时设置、cron 表达式
   - RESOURCE:
     * 检查 VC 状态和队列排队情况
2. 调用 list_task_run 查看历史，判断是否偶发
3. 生成解决方案
```

### 3.4 数据质量错误诊断

```
1. 调用 get_task_detail 获取 DQC 规则配置
2. 调用 get_execution_log 获取校验结果详情
3. 分析失败原因：
   - 规则配置是否合理
   - 数据本身是否有问题
4. 生成修复建议
```

---

## Step 4: 生成解决方案

根据诊断结果，从以下维度生成解决方案：

### 解决方案结构

```
标题: [简明描述问题和解决方向]
根因: [一句话说明根本原因]
步骤:
  1. [具体操作步骤1]
  2. [具体操作步骤2]
  ...
预期效果: [执行后的预期结果]
注意事项: [可选，需要特别注意的点]
```

### 常见解决方案

参考 `reference/solutions.yaml` 获取预定义的解决方案模板。

---

## Step 5: 输出诊断报告

### 报告格式

```markdown
## 诊断报告

**任务信息**
- 任务ID: {task_id}
- 实例ID: {instance_id}
- 任务类型: {task_type}

**错误分类**
- 类别: {category}
- 子类型: {error_type}

**根因分析**
{root_cause_description}

**解决方案**
{solution}

**诊断路径**
{diagnosis_steps}
```

---

## 注意事项

1. **信息脱敏**：输出时不要暴露敏感信息（密码、token、内部 IP 等）
2. **降级处理**：如果某个工具调用失败，基于已有信息继续诊断
3. **兜底方案**：如果无法确定错误类型，提供通用排查建议
4. **追问确认**：信息不足时，主动向用户询问 task_id 或 instance_id

---

## 相关资源

- `reference/error_patterns.md` - 错误特征模式配置
- `reference/solutions.md` - 解决方案模板
- `reference/examples.md` - 诊断案例库（真实案例及诊断思路）

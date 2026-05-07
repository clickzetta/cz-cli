# EXPLAIN 命令产品文档

## 概述

EXPLAIN 是 ClickZetta Lakehouse 中用于分析 SQL 查询执行计划的诊断命令。通过查看执行计划，用户可以理解查询的执行流程、识别性能瓶颈并进行针对性的查询优化。该命令支持基础和扩展两种输出模式。

## 命令语法

```sql
EXPLAIN [EXTENDED] query_statement
```

## 执行计划模式

### 1. 基础执行计划模式（EXPLAIN）

基础模式显示查询的物理执行计划，用于快速理解查询的执行方式。

#### 特点

* **轻量级输出**：显示物理执行的核心步骤
* **快速诊断**：用于快速识别查询的执行方式
* **包含内容**：物理表扫描、表数据输出、操作符名称和阶段信息。

#### 语法

```sql
EXPLAIN query_statement
```

#### 示例

```sql
EXPLAIN SELECT * FROM a_decimal LIMIT 5
```

**验证结果（实际输出）**：

```
Type: DMLPlan: PhysicalTableSink() name=TableSink0 stage=stg0  PhysicalTableScan(a_decimal, a) as [0] name=TableScan1
```

### 2. 扩展执行计划模式（EXPLAIN EXTENDED）

扩展模式显示完整的逻辑执行计划和物理执行计划，包含更多的优化细节信息。

#### 特点

* **完整输出**：包含逻辑计划和物理计划两个层面
* **详细分析**：显示表达式转换、系统列、优化过程等。

* **包含内容**：

  * 逻辑执行计划（LogicalPlan）
  * 物理执行计划（DML）
  * 系统隐藏列信息
  * 表达式类型转换

#### 语法

```sql
EXPLAIN EXTENDED query_statement
```

#### 示例

以下命令已通过ClickZetta MCP Server验证：

```sql
EXPLAIN EXTENDED SELECT * FROM a_decimal LIMIT 5
```

**验证结果（实际输出）**：

```
[LogicalPlan]Type: LogicalPlanPlan: TableSink()  LogicalSort(_TRY_TO_INT64(5))    LogicalCalc($0 as 0) as [0]      TableScan(a_decimal, a, ORIGINAL__SLICE__ID, ORIGINAL__ROW__OFFSET,        row_offset_in_file, __incremental_deleted, __commit_version,        __change_type, __commit_timestamp, INPUT__FILE__NAME,        FILE__SLICE__ID, __data_source_id, __snapshot_id) as [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11][PhysicalPlan]Type: DMLPlan: PhysicalTableSink() name=TableSink0 stage=stg0  PhysicalTableScan(a_decimal, a) as [0] name=TableScan1
```



## 执行计划中的常见操作符

| 操作符                   | 说明         | 性能特征                     |
| --------------------- | ------------ | -------------------------- |
| PhysicalTableScan     | 从表读取数据   | 基础 I/O 操作                |
| PhysicalTableSink     | 输出查询结果   | 固定开销                     |
| PhysicalSort          | 对数据排序     | O(n log n)，可能成为瓶颈      |
| PhysicalFilter        | 条件过滤       | 线性操作，早期过滤是最佳实践       |
| PhysicalHashAggregate | 聚合操作       | 根据 GROUP BY 基数变化        |
| PhysicalJoin          | JOIN 操作     | 复杂度取决于 JOIN 策略和数据量 |



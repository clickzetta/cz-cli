# 云器 Lakehouse Table Stream 最佳实践指南

## Table Stream 在企业数据组织中的角色

在现代数据驱动型企业中，数据变更的实时捕获和处理已成为关键能力。企业数据组织通常面临以下挑战：

* 跨系统数据同步延迟导致的决策滞后
* 复杂 ETL 流程中的增量更新困难
* 数据变更历史追踪和审计的复杂性
* 实时数据集成和事件驱动架构的实现难度

云器 Lakehouse 的 Table Stream 功能正是为解决这些挑战而设计的核心组件。它在企业数据组织中扮演着关键角色：

1. **数据集成中枢**：作为变更数据捕获（CDC）的核心机制，促进不同系统间的实时数据流动
2. **数据质量保障**：提供数据变更的可追溯性，支持数据血缘和影响分析
3. **实时分析基础**：为实时数据仓库、即时报表和仪表盘提供数据变更流
4. **事件驱动触发器**：作为事件源，驱动下游业务流程和自动化操作
5. **数据治理支柱**：支持合规要求，记录敏感数据的变更历史

在数据架构中，Table Stream 连接了 OLTP 系统和分析系统，使企业能够建立“流批一体”的现代数据平台，提升数据时效性和业务响应速度。

## 目录

1. [简介](#1-简介)
2. [准备工作](#2-准备工作)
3. [创建和配置](#3-创建和配置)
4. [使用不同模式](#4-使用不同模式)
5. [消费和处理数据](#5-消费和处理数据)
6. [元数据字段使用](#6-元数据字段使用)
7. [实际应用场景](#7-实际应用场景)
8. [性能优化](#8-性能优化)
9. [常见问题和解决方案](#9-常见问题和解决方案)
10. [最佳实践总结](#10-最佳实践总结)

## 1. 简介

### 1.1 什么是Table Stream

Table Stream 是云器 Lakehouse 架构中的核心功能，提供变更数据捕获 (CDC) 能力，用于记录表中数据的插入、更新和删除操作。它创建了一个“变更表”，使用户能够查询和消费两个事务时间点之间的行级变更记录。

### 1.2 核心功能

* **变更捕获**：记录表级 DML 操作 (INSERT、UPDATE、DELETE)
* **元数据记录**：提供每次变更的版本、时间戳等元数据
* **增量处理**：支持增量读取和处理数据变更
* **消费机制**：支持通过 DML 操作消费变更数据并移动 offset

### 1.3 适用场景

* 数据同步和复制
* 实时数据集成
* 增量 ETL/ELT 流程
* 审计和数据治理
* 事件驱动架构

## 2. 准备工作

### 2.1 表配置要求

在使用Table Stream之前，必须确保源表已正确配置：

```sql
-- 创建源表示例
CREATE TABLE source_table (
    id INT,
    name STRING,
    value DOUBLE,
    updated_at TIMESTAMP
);
```

### 2.2 开启变更跟踪（必需步骤）

**重要**：必须在源表上开启变更跟踪才能创建 Table Stream：

```sql
-- 开启变更跟踪
ALTER TABLE source_table SET PROPERTIES ('change_tracking' = 'true');
```

这一步是**强制性**的，如果不执行，Table Stream 可能会创建成功但无法正确捕获变更。

### 2.3 准备目标表

如果计划将Stream数据写入目标表，提前创建具有兼容结构的目标表：

```sql
-- 创建目标表
CREATE TABLE target_table (
    id INT,
    name STRING,
    value DOUBLE,
    updated_at TIMESTAMP
);
```

## 3. 创建和配置

### 3.1 基本语法

创建Table Stream的基本语法：

```sql
CREATE TABLE STREAM stream_name 
ON TABLE source_table
[COMMENT 'stream description']
WITH PROPERTIES (
    'TABLE_STREAM_MODE' = 'STANDARD|APPEND_ONLY',
    ['SHOW_INITIAL_ROWS' = 'TRUE|FALSE']
);
```

### 3.2 重要参数

#### 3.2.1 TABLE\_STREAM\_MODE

* **STANDARD**：捕获所有DML操作(INSERT、UPDATE、DELETE)，反映表的当前状态
* **APPEND\_ONLY**：只捕获INSERT操作，即使行被更新或删除也保留原始INSERT记录

#### 3.2.2 SHOW\_INITIAL\_ROWS

* **TRUE**：首次消费时返回创建Stream时表中的所有现有行
* **FALSE**（默认）：首次消费只返回创建Stream后的新变更

### 3.3 时间点设置

可以指定Stream开始捕获变更的时间点：

```sql
CREATE TABLE STREAM stream_name 
ON TABLE source_table
TIMESTAMP AS OF current_timestamp()
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');
```

**最佳实践**：使用 `current_timestamp()` 或具体的时间戳字符串，避免使用复杂的时间表达式。

### 3.4 注释添加

为Stream添加描述性注释：

```sql
CREATE TABLE STREAM stream_name 
ON TABLE source_table
COMMENT '捕获source_table的数据变更'
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');
```

**注意**：使用正确的语法 `COMMENT '注释内容'`，而非 `COMMENT = '注释内容'`。

## 4. 使用不同模式

### 4.1 STANDARD模式

**推荐用途**：需要表的完整当前状态，包括更新和删除操作。

```sql
CREATE TABLE STREAM standard_stream 
ON TABLE source_table
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');
```

特点：

* 准确反映表的当前状态
* 更新会显示最新值
* 已删除的行不会出现在结果中

### 4.2 APPEND\_ONLY模式

**推荐用途**：需要保留所有插入记录，包括后续被更新或删除的记录。

```sql
CREATE TABLE STREAM append_stream 
ON TABLE source_table
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'APPEND_ONLY');
```

特点：

* 记录所有INSERT操作
* 不反映UPDATE和DELETE操作
* 即使行被删除，原始INSERT记录仍会保留

### 4.3 模式选择指南

| 需求             | 推荐模式         |
| -------------- | ------------ |
| 数据同步（保持目标与源一致） | STANDARD     |
| 审计所有插入记录       | APPEND\_ONLY |
| 增量ETL流程        | STANDARD     |
| 历史记录保留         | APPEND\_ONLY |

## 5. 消费和处理数据

### 5.1 查询Stream数据

```sql
-- 查询Stream中的变更数据
SELECT * FROM my_stream;
```

**重要**：仅使用 SELECT 查询不会移动 Stream 的 offset。

### 5.2 消费和移动Offset

要移动 Stream 的 offset（消费数据），必须使用 DML 操作：

```sql
-- 将Stream数据插入目标表（会移动offset）
INSERT INTO target_table
SELECT id, name, value, updated_at 
FROM my_stream;
```

### 5.3 消费模式

#### 5.3.1 全量消费

```sql
-- 消费Stream中的所有变更数据
INSERT INTO target_table
SELECT id, name, value, updated_at 
FROM my_stream;
```

#### 5.3.2 条件消费

```sql
-- 仅消费特定条件的变更数据
INSERT INTO target_table
SELECT id, name, value, updated_at 
FROM my_stream
WHERE value > 100;
```

**注意**：即使使用 WHERE 条件，所有 Stream 数据的 offset 仍会移动。

### 5.4 验证消费状态

通过再次查询Stream，验证数据是否被消费：

```sql
-- 验证消费后的Stream状态
SELECT COUNT(*) FROM my_stream;
```

如果消费成功，COUNT应该为0或只包含新的变更数据。

## 6. 元数据字段使用

### 6.1 可用元数据字段

Table Stream返回的结果包含以下元数据字段：

* `__change_type`：变更类型
* `__commit_version`：提交版本
* `__commit_timestamp`：提交时间戳

### 6.2 变更类型判断

**注意**：根据我们的测试，`__change_type` 字段的实际行为可能与文档描述不一致。所有记录都标记为“INSERT”，即使是更新或删除操作。

因此，建议通过以下方式判断变更类型：

1. **INSERT操作**：新记录出现在Stream中
2. **UPDATE操作**：同一ID记录的`__commit_version`字段值增加
3. **DELETE操作**：记录不再出现在 STANDARD 模式的结果中

### 6.3 使用元数据实现增量处理

```sql
-- 基于提交版本筛选
SELECT * FROM my_stream
WHERE __commit_version > last_processed_version;

-- 基于提交时间筛选
SELECT * FROM my_stream
WHERE __commit_timestamp > TIMESTAMP '2025-05-01 00:00:00';
```

### 6.4 元数据字段最佳实践

* 不要依赖 `__change_type` 字段区分操作类型
* 使用 `__commit_version` 和 `__commit_timestamp` 跟踪变更
* 关注数据的最终状态而非变更过程
* 保存消费的最大版本号，用于故障恢复

## 7. 实际应用场景

### 7.1 实时数据同步

```sql
-- 定期执行，将变更同步到目标表
INSERT INTO target_table
SELECT id, name, value, updated_at 
FROM source_stream;
```

可结合定时任务或触发器实现自动同步。

### 7.2 增量ETL流程

```sql
-- 增量提取、转换并加载数据
INSERT INTO dwh_fact_table (dimension_id, metric_value, load_date)
SELECT 
    dim.dimension_id,
    stream.value,
    current_date()
FROM source_stream stream
JOIN dimension_table dim ON stream.id = dim.source_id;
```

### 7.3 事件驱动处理

```sql
-- 检测特定事件并触发处理
CREATE OR REPLACE PROCEDURE process_high_value_changes() AS
BEGIN
    -- 检查是否有高价值变更
    DECLARE high_value_changes CURSOR FOR 
        SELECT * FROM value_stream WHERE value > 1000;
    
    -- 处理这些变更
    FOR change IN high_value_changes DO
        -- 执行处理逻辑
        INSERT INTO high_value_alerts VALUES (change.id, change.value, current_timestamp());
    END FOR;
    
    -- 消费所有变更
    INSERT INTO processed_changes
    SELECT * FROM value_stream;
END;
```

### 7.4 审计跟踪

```sql
-- 捕获所有变更用于审计
CREATE TABLE STREAM audit_stream 
ON TABLE sensitive_data
WITH PROPERTIES (
    'TABLE_STREAM_MODE' = 'APPEND_ONLY',
    'SHOW_INITIAL_ROWS' = 'TRUE'
);

-- 定期归档到审计表
INSERT INTO audit_history
SELECT 
    *,
    __commit_timestamp AS audit_timestamp,
    __commit_version AS change_version
FROM audit_stream;
```

## 8. 性能优化

### 8.1 减少数据体积

* 只选择必要的列而非 `SELECT *`
* 在源表上设置适当的保留期
* 定期消费Stream数据以避免累积

### 8.2 批量处理

```sql
-- 批量消费多个Stream并合并处理
INSERT INTO consolidated_target
SELECT 'customers' AS source, id, name, NULL AS product_id, NULL AS order_id, __commit_timestamp
FROM customer_stream
UNION ALL
SELECT 'products' AS source, id, name, product_id, NULL AS order_id, __commit_timestamp
FROM product_stream
UNION ALL
SELECT 'orders' AS source, id, NULL AS name, NULL AS product_id, order_id, __commit_timestamp
FROM order_stream;
```

### 8.3 并行处理

将大型Stream拆分为多个较小的部分并行处理：

```sql
-- 分区1处理
INSERT INTO target_partition_1
SELECT * FROM source_stream WHERE MOD(id, 4) = 0;

-- 分区2处理
INSERT INTO target_partition_2
SELECT * FROM source_stream WHERE MOD(id, 4) = 1;

-- 以此类推...
```

### 8.4 频率优化

* 高变更率表：更频繁地消费Stream
* 低变更率表：降低消费频率
* 关键表：实时或近实时消费
* 非关键表：批量定期消费

## 9. 常见问题和解决方案

### 9.1 Stream不捕获变更

**问题**：创建 Stream 后未能捕获表变更。

**解决方案**：

1. 确认已开启变更跟踪：`ALTER TABLE table_name SET PROPERTIES ('change_tracking' = 'true')`
2. 验证是否有足够权限
3. 确认 DML 操作在 Stream 创建后执行

### 9.2 无法区分变更类型

**问题**：所有变更都标记为INSERT，无法区分更新和删除。

**解决方案**：

1. 使用 `__commit_version` 变化判断更新
2. 记录之前的状态并与当前比较
3. 对于STANDARD模式，通过记录是否存在来判断删除

### 9.3 重复消费数据

**问题**：重复运行消费逻辑导致目标表出现重复数据。

**解决方案**：

1. 使用MERGE语句替代INSERT
2. 实现幂等性处理
3. 记录最后消费的版本和时间戳

```sql
-- 幂等消费示例
MERGE INTO target_table t
USING my_stream s
ON t.id = s.id
WHEN MATCHED THEN
    UPDATE SET 
        t.name = s.name,
        t.value = s.value,
        t.updated_at = s.updated_at
WHEN NOT MATCHED THEN
    INSERT (id, name, value, updated_at)
    VALUES (s.id, s.name, s.value, s.updated_at);
```

### 9.4 消费后未移动Offset

**问题**：消费后再次查询仍返回相同数据。

**解决方案**：

1. 确保使用 DML 操作消费数据（INSERT、UPDATE、MERGE）
2. 不要仅使用 SELECT 查询，这不会移动 offset
3. 检查 DML 操作是否成功提交

## 10. 最佳实践总结

### 10.1 设计原则

1. **始终开启变更跟踪**：在创建Stream前开启表的变更跟踪
2. **选择合适的模式**：根据需求选择STANDARD或APPEND\_ONLY模式
3. **定期消费**：不要让Stream累积过多数据
4. **关注最终状态**：重点关注数据的最终状态而非变更过程
5. **不依赖变更类型**：不要依赖 `__change_type` 字段区分操作类型

### 10.2 使用清单

* [ ] 在源表上开启change\_tracking
* [ ] 选择合适的Stream模式
* [ ] 考虑是否需要SHOW\_INITIAL\_ROWS
* [ ] 使用DML操作消费数据
* [ ] 实现幂等性消费机制
* [ ] 监控Stream大小和性能
* [ ] 记录消费的版本和时间戳
* [ ] 实现错误处理和重试逻辑

### 10.3 成功实现的关键

* **理解机制**：掌握Stream的工作原理和限制
* **适当测试**：在生产环境部署前充分测试
* **定期维护**：监控和优化Stream性能
* **记录状态**：跟踪消费状态，确保数据一致性
* **容错设计**：考虑故障恢复和边缘情况

遵循这些最佳实践，您将能够充分利用云器Lakehouse Table Stream功能，构建高效可靠的数据变更捕获和处理流程。

## 参考文档

1. [云器 Table Stream 文档](tablestream_summary.md) - 功能描述和语法参考
2. [云器 Table Stream 创建语法](create-table-stream.md) - 详细的创建语法和参数说明
3. [变更数据捕获 (CDC) 最佳实践 ](<czguide-intro-to-cdc-using-clickzetta-rtsync-dynamic-tables.md>) - 变更数据捕获相关的一般性最佳实践
4. [云器 SQL参考手册](sql-reference.md) - 完整的SQL语法参考，包括Table Stream相关操作

***

*注：本指南基于 2025 年 5 月的云器 Lakehouse 版本测试结果，后续版本可能有所变化。请定期检查官方文档以获取最新信息。*

# OPTIMIZE 命令

## 概述

OPTIMIZE 是 ClickZetta Lakehouse 中用于表数据优化和压缩的核心操作命令。通过整合小文件、清理删除标记和重组数据布局，可以显著改善查询性能和存储效率。虽然 Lakehouse 后台会默认定期自动执行文件合并，但在频繁更新或需要精细控制合并频率的场景中，用户可以通过手动调用该命令来满足特定业务需求。该命令支持异步和同步两种执行模式，为不同场景提供灵活的优化方案。

## 命令语法

```sql
OPTIMIZE table_name 
[WHERE predicate]  -- 可选分区过滤条件
[OPTIONS(...)]
```

1. table_name（必选）

* 需要优化的目标表名称，格式为 `[schema_name.]table_name`

2. WHERE predicate（可选）

* 分区过滤条件，必须包含**完整的分区列匹配条件**。
* 支持格式：`partition_column = 'value'` 或复合分区 `dt='2023-01-01' AND region='us'`。

3. OPTIONS（可选）

* Lakehouse 保留参数，用于控制优化行为。

## 注意事项

* 该功能只能在**通用型计算集群（GENERAL PURPOSE VIRTUAL CLUSTER）**中运行，在分析型集群中该功能不会生效。

## 核心功能

* **小文件合并**：将多个小数据文件整合为大文件，减少文件元数据开销。
* **删除标记清理**：清理 UPDATE/DELETE 操作产生的删除标记，回收存储空间。
* **数据重组**：重新整理数据布局，提升查询性能。

## 执行模式

### 1. 异步执行模式（默认）

异步执行是 OPTIMIZE 的默认行为，操作在后台进行，不阻塞当前连接。

#### 特点

* **非阻塞**：立即返回 Job ID，操作在后台执行。

#### 语法

```sql
-- 默认异步执行
OPTIMIZE table_name;

-- 显式指定异步执行
OPTIMIZE table_name OPTIONS('cz.sql.optimize.table.async' = 'true');
```

### 2. 同步执行模式

同步执行会阻塞当前连接，直到优化操作完全完成后才返回结果。

#### 特点

* **阻塞式**：操作完成才返回，期间连接被占用。
* **实时反馈**：立即获得详细的执行统计和成功状态。
* **适用场景**：开发测试、小表优化、验证优化效果。
* **确定性**：确保操作完全完成。

#### 语法

```sql
OPTIMIZE table_name OPTIONS('cz.sql.optimize.table.async' = 'false');
```

## 适用场景

* 大量 UPDATE/DELETE 操作后的存储清理
* 释放临时存储空间的定期维护任务
* 优化表的总体存储布局


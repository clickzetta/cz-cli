# Lakehouse SQL DML语句使用指南

## 1. INSERT语句规范

### 1.1 基本语法

```sql
INSERT INTO|OVERWRITE [TABLE] table_name 
    [ PARTITION partition_spec] 
    [ (column1, column2, ...)] 
    {VALUES(value1 [,...],(value2 [,...]),...) | subquery}
```

### 1.2 推荐的数据导入方式

#### 大量数据导入 - 首选方案

* **推荐使用**：`INSERT INTO...SELECT` 语句
* **推荐使用**：COPY INTO命令配合Volume存储
* **推荐使用**：专业数据导入工具

```sql
-- ✅ 推荐：使用SELECT方式
INSERT INTO target_table 
SELECT col1, col2, col3 FROM source_table WHERE condition;

-- ✅ 推荐：使用COPY INTO命令
COPY INTO target_table 
FROM VOLUME my_volume 
USING CSV OPTIONS ('header' = 'true');
```

#### 小量数据导入 - VALUES方式

```sql
-- ✅ 适用场景：少量数据（建议100行以内）
INSERT INTO table_name VALUES 
(1, 'data1'), (2, 'data2'), (3, 'data3');
```

**推荐方式的优势**：

* 更高的导入性能和吞吐量
* 更好的资源利用率
* 支持事务性保证
* 减少网络传输开销

### 1.3 数据类型Literal语法

#### 必须使用前缀的类型

```sql
date'2023-12-25'                       -- DATE类型
timestamp'2023-12-25 15:30:45'         -- TIMESTAMP类型
timestamp'2023-12-25 15:30:45.123'     -- 支持毫秒精度
json'{"key": "value", "num": 123}'     -- JSON类型
X'48656C6C6F'                          -- BINARY类型（十六进制）
```

#### 可选使用后缀的类型

```sql
-- 数值类型后缀为可选，两种写法均正确
1       -- 或 1l (BIGINT)
100     -- 或 100s (SMALLINT)  
200     -- INT类型
89.5    -- 或 89.5f (FLOAT)
3.14159 -- 或 3.14159d (DOUBLE)
99.99   -- 或 99.99bd (DECIMAL)
```

#### 复合类型语法

```sql
ARRAY(1,2,3)                          -- ARRAY类型
MAP('k1','v1','k2','v2')             -- MAP类型
STRUCT(1, 'hello', 3.14)             -- STRUCT类型
```

### 1.4 INSERT OVERWRITE行为

* **分区表**：覆盖匹配的分区数据
* **非分区表**：覆盖整表数据
* **前提条件**：目标表必须存在

### 1.5 分区操作限制

* **分区数量上限**：单任务最多2048个分区
* **超限处理**：分批导入或优化分区策略
* **建议检查**：大批量导入前统计分区数量

### 1.6 列映射和类型匹配

* **显式指定**：建议明确指定目标列名
* **类型匹配**：确保数据类型精确对应
* **NULL处理**：未指定列将填入NULL值

## 2. UPDATE语句规范

### 2.1 基本语法

```sql
UPDATE target_table 
SET column_name1 = new_value1 [, column_name2 = new_value2, ...] 
[ WHERE condition ] 
[ORDER BY ...] 
[LIMIT row_count]
```

### 2.2 WHERE条件要求

* **必要性**：强烈建议使用WHERE条件限制更新范围
* **精确性**：使用精确条件避免误操作
* **复杂查询**：支持子查询和表达式

### 2.3 批量更新优化

* **分批处理**：使用ORDER BY + LIMIT实现分批更新
* **确定性**：ORDER BY保证更新顺序一致性
* **性能控制**：LIMIT控制单次更新行数

### 2.4 安全操作建议

* **测试验证**：生产环境前在测试环境验证
* **数据备份**：重要更新前创建备份
* **回滚准备**：准备数据恢复方案

## 3. DELETE语句规范

### 3.1 基本语法

```sql
DELETE FROM table_name WHERE condition;
```

### 3.2 安全要求

* **WHERE条件**：避免省略WHERE导致全表删除
* **条件验证**：删除前验证条件的准确性
* **备份保护**：重要数据删除前备份

### 3.3 性能优化

* **索引利用**：WHERE条件充分利用索引
* **分区过滤**：分区表使用分区列进行过滤
* **批量删除**：大批量删除考虑分批执行

## 4. MERGE INTO语句规范

### 4.1 基本语法

```sql
MERGE INTO target_table USING source_table ON merge_condition 
{ WHEN MATCHED [AND matched_condition] THEN matched_action |
  WHEN NOT MATCHED [AND not_matched_condition] THEN not_matched_action } ...
```

### 4.2 语句顺序要求

**WHEN MATCHED 必须在 WHEN NOT MATCHED 之前**

```sql
-- ✅ 正确顺序
MERGE INTO target USING source ON target.key = source.key 
WHEN MATCHED THEN UPDATE SET target.col1 = source.col1
WHEN NOT MATCHED THEN INSERT (col1, col2) VALUES (source.col1, source.col2);
```

### 4.3 匹配条件设计

* **唯一性**：确保ON条件产生一对一匹配
* **确定性**：避免源表多行匹配目标表同一行
* **过滤支持**：支持AND条件进行额外过滤

### 4.4 操作类型

* **MATCHED操作**：UPDATE SET 或 DELETE
* **NOT MATCHED操作**：INSERT语句
* **条件执行**：按指定顺序执行多个WHEN子句

## 5. TRUNCATE语句规范

### 5.1 基本语法

```sql
TRUNCATE TABLE [IF EXISTS] table_name;
```

### 5.2 操作特点

* **数据清空**：删除所有记录但保留表结构
* **性能优势**：比DELETE FROM更高效
* **不可恢复**：操作后数据无法直接恢复

### 5.3 使用建议

* **IF EXISTS**：使用IF EXISTS子句避免错误
* **权限检查**：确保具有相应操作权限
* **备份保护**：重要表操作前备份数据

## 6. Dynamic Table DML规范

### 6.1 参数配置

```sql
-- 建议显式启用DML操作
SET cz.sql.dt.allow.dml = true;
```

### 6.2 支持的操作

```sql
-- ✅ 完全支持
INSERT INTO dynamic_table VALUES (1, 'data', 100);
INSERT OVERWRITE dynamic_table SELECT * FROM source;
DELETE FROM dynamic_table WHERE condition;
TRUNCATE TABLE dynamic_table;
```

### 6.3 操作限制

* **UPDATE限制**：UPDATE 操作存在技术限制，建议使用 DELETE + INSERT 替代
* **刷新影响**：DML操作可能导致下次刷新转为全量模式
* **性能考虑**：全量刷新比增量刷新开销更大

## 7. 性能优化策略

### 7.1 分区设计原则

* **分区大小**：遵循业界标准，避免过小分区影响查询性能
* **分区数量**：控制分区总数，平衡存储和查询效率
* **过滤优化**：分区列应为常用过滤条件

### 7.2 分桶配置策略

* **分桶列选择**：选择高基数、分布均匀的列
* **分桶数量**：基于数据量和查询模式确定合理数量
* **排序优化**：SORTED BY选择频繁查询的列

### 7.3 索引优化

* **BLOOM FILTER 索引**：适用于等值查询和高基数列
* **INVERTED 索引**：适用于全文搜索，需指定分析器
* **VECTOR 索引**：适用于向量相似度搜索场景

### 7.4 小文件管理

```sql
-- 自动合并配置
SET cz.sql.compaction.after.commit = true;

-- 手动合并命令
OPTIMIZE table_name [WHERE predicate] [OPTIONS ('key' = 'value')];
```

## 8. 数据类型转换

### 8.1 转换方法

```sql
-- CAST函数
CAST(expression AS type)

-- 转换运算符
expression::type

-- TYPE函数（转换失败返回NULL）
TYPE(expr)
```

### 8.2 转换规则

* **数值扩展**：支持精度扩大的转换
* **字符串转换**：支持长度增加的转换
* **日期转换**：字符串与日期类型双向转换
* **溢出处理**：注意数值转换的溢出风险

### 8.3 TIMESTAMP处理

* **格式支持**：标准格式、毫秒精度、ISO 8601
* **时区处理**：默认TIMESTAMP\_LTZ类型
* **精度支持**：最高支持微秒精度

## 9. 事务和版本控制

### 9.1 历史版本查询

#### 查看表历史版本

```sql
-- 查看表的完整操作历史
DESCRIBE HISTORY table_name;
```

返回信息包括：

* **version**：版本号
* **time**：操作时间
* **total_rows**：该版本的总行数
* **operation**：操作类型（CREATE、INSERT_INTO、UPDATE、DELETE、TRUNCATE 等）
* **user**：执行用户
* **job_id**：作业 ID

#### Time Travel查询

```sql
-- 使用相对时间查询历史数据
SELECT * FROM table_name 
TIMESTAMP AS OF (CURRENT_TIMESTAMP() - INTERVAL '1' HOUR);

-- 使用绝对时间查询（需要精确的时间戳）
SELECT * FROM table_name 
TIMESTAMP AS OF '2025-06-18 10:30:45.123';

-- 使用CAST函数指定时区
SELECT * FROM table_name 
TIMESTAMP AS OF CAST('2025-06-18 10:30:45 Asia/Shanghai' AS TIMESTAMP);
```

### 9.2 数据恢复操作

#### 表数据恢复

```sql
-- 恢复表到指定时间点
RESTORE TABLE table_name TO TIMESTAMP AS OF '2025-06-18 10:30:45';

-- 恢复Dynamic Table
RESTORE DYNAMIC TABLE table_name TO TIMESTAMP AS OF '2025-06-18 10:30:45';
```

支持的时间格式：

* 完整时间戳：'2025-06-18 10:30:45.123'
* 秒级精度：'2025-06-18 10:30:45'
* 带时区格式：'2025-06-18 10:30:45 Asia/Shanghai'
* 相对时间：CURRENT\_TIMESTAMP() - INTERVAL '1' DAY

#### 恢复已删除对象

```sql
-- 恢复被删除的表
UNDROP TABLE table_name;

-- 恢复被删除的Dynamic Table
UNDROP DYNAMIC TABLE table_name;

-- 恢复被删除的物化视图
UNDROP MATERIALIZED VIEW view_name;
```

### 9.3 变更跟踪配置

#### 启用变更跟踪

```sql
-- 为表启用变更跟踪功能
ALTER TABLE table_name SET PROPERTIES('change_tracking' = 'true');
```

#### 创建Table Stream

```sql
-- 创建标准模式的Table Stream
CREATE TABLE STREAM stream_name 
ON TABLE table_name
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');

-- 创建仅追加模式的Table Stream
CREATE TABLE STREAM stream_name 
ON TABLE table_name
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'APPEND_ONLY');
```

### 9.4 数据保留策略

#### 设置数据保留周期

```sql
-- 设置Time Travel数据保留周期（单位：天）
ALTER TABLE table_name SET PROPERTIES('data_retention_days' = '7');

-- 设置数据生命周期（自动清理历史数据）
ALTER TABLE table_name SET PROPERTIES('data_lifecycle' = '365');
```

#### 查询历史加载记录

```sql
-- 查看表的历史加载记录
SELECT * FROM load_history('schema.table_name');
```

## 10. 系统参数配置

### 10.1 DML相关参数

```sql
-- Dynamic Table DML启用
SET cz.sql.dt.allow.dml = true;

-- 小文件自动合并
SET cz.sql.compaction.after.commit = true;

-- 查询标签设置
SET query_tag = 'dml_operation';

-- 会话时区配置
SET timezone = 'Asia/Shanghai';
```

### 10.2 工作空间级别配置

#### 自动索引推荐

```sql
-- 启用工作空间级别的自动索引推荐
ALTER WORKSPACE workspace_name SET properties (auto_index='day[,150,5,100]');
```

参数说明：

* **day**：推荐频率（按天）
* **150**：查询次数阈值
* **5**：查询耗时阈值（秒）
* **100**：索引推荐数量限制

## 11. 错误处理指南

### 11.1 常见错误类型

#### 数据类型转换错误

```
错误信息：implicit cast not allowed for 'colX': string not null to date/timestamp/json/binary
解决方案：使用正确的类型前缀语法
```

#### 分区数量超限错误

```
错误信息：The count of dynamic partitions exceeds the maximum number 2048
解决方案：分批导入或优化分区策略
```

#### MERGE语句顺序错误

```
错误信息：Syntax error at or near 'WHEN'
解决方案：调整WHEN子句顺序
```

#### Dynamic Table UPDATE限制

```
错误信息：Not support hidden column :MV__KEY
解决方案：使用DELETE + INSERT替代UPDATE
```

### 11.2 性能诊断

```sql
-- 查询执行计划
EXPLAIN SELECT * FROM table_name WHERE condition;

-- 分区信息检查
SHOW PARTITIONS EXTENDED table_name;
```

## 12. 最佳实践

### 12.1 数据类型使用规范

| 数据类型      | 前缀要求 | 语法示例                             |
| --------- | ---- | -------------------------------- |
| DATE      | 必须   | `date'2023-12-25'`               |
| TIMESTAMP | 必须   | `timestamp'2023-12-25 15:30:45'` |
| JSON      | 必须   | `json'{"key": "value"}'`         |
| BINARY    | 必须   | `X'48656C6C6F'`                  |
| BIGINT    | 可选   | `1` 或 `1l`                       |
| DECIMAL   | 可选   | `99.99` 或 `99.99bd`              |
| FLOAT     | 可选   | `89.5` 或 `89.5f`                 |
| DOUBLE    | 可选   | `3.14` 或 `3.14d`                 |

### 11.2 INSERT语句模板

```sql
-- 推荐的大量数据导入
INSERT INTO target_table 
SELECT col1, col2, col3 FROM source_table WHERE condition;

-- 类型安全的VALUES插入
INSERT INTO table_name (
    bigint_col, decimal_col, date_col, 
    timestamp_col, json_col, binary_col
) VALUES (
    1, 99.99, date'2023-12-25',
    timestamp'2023-12-25 15:30:45',
    json'{"key": "value"}', X'48656C6C6F'
);
```

### 11.3 MERGE语句模板

```sql
MERGE INTO target_table AS target 
USING source_table AS source 
ON target.key_column = source.key_column 
WHEN MATCHED THEN 
    UPDATE SET target.col1 = source.col1, target.col2 = source.col2
WHEN NOT MATCHED THEN 
    INSERT (key_column, col1, col2) 
    VALUES (source.key_column, source.col1, source.col2);
```

### 11.4 Dynamic Table DML模板

```sql
-- 会话配置
SET cz.sql.dt.allow.dml = true;

-- 支持的操作
INSERT INTO dynamic_table VALUES (1, 'data', 100);
DELETE FROM dynamic_table WHERE condition;

-- 替代UPDATE的方案
DELETE FROM dynamic_table WHERE key_column = target_value;
INSERT INTO dynamic_table VALUES (new_key, new_col1, new_col2);
```

### 11.5 安全操作原则

1. **测试先行**：生产环境操作前完成测试验证
2. **备份保护**：重要数据操作前创建备份
3. **权限最小化**：使用最小必要权限执行操作
4. **条件精确**：WHERE条件精确限制操作范围
5. **监控审计**：记录重要DML操作的执行日志

### 11.6 性能优化原则

1. **批量优先**：优先使用批量操作提高效率
2. **索引利用**：充分利用索引加速查询和DML
3. **分区过滤**：利用分区剪枝减少数据扫描
4. **资源管理**：合理配置计算资源和并发度
5. **文件管理**：定期执行小文件合并优化

### 12.6 版本控制和数据恢复原则

1. **数据保留设置**：根据业务需求合理设置数据保留周期
2. **变更跟踪启用**：对重要表启用变更跟踪便于数据审计
3. **定期检查历史**：定期查看表操作历史发现异常操作
4. **恢复操作验证**：数据恢复前在测试环境验证恢复效果
5. **Time Travel 查询**：使用相对时间查询避免时区问题

### 12.7 Table Stream 使用原则

```sql
-- 推荐的Stream创建和使用模式
-- 1. 启用变更跟踪
ALTER TABLE source_table SET PROPERTIES('change_tracking' = 'true');

-- 2. 创建Stream
CREATE TABLE STREAM change_stream 
ON TABLE source_table
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');

-- 3. 查询变更数据
SELECT * FROM change_stream WHERE cz_stream_action IN ('INSERT', 'UPDATE', 'DELETE');
```

### 12.8 历史版本和数据恢复模板

```sql
-- 查看表历史
DESCRIBE HISTORY table_name;

-- Time Travel查询
SELECT * FROM table_name 
TIMESTAMP AS OF (CURRENT_TIMESTAMP() - INTERVAL '1' HOUR);

-- 数据恢复
RESTORE TABLE table_name TO TIMESTAMP AS OF '20<https://j4vjdq19vx.x.topthink.com/#>25-06-18 10:30:45';

-- 恢复删除的表
UNDROP TABLE table_name;

-- 启用变更跟踪
ALTER TABLE table_name SET PROPERTIES('change_tracking' = 'true');

-- 创建Table Stream
CREATE TABLE STREAM stream_name 
ON TABLE table_name
WITH PROPERTIES ('TABLE_STREAM_MODE' = 'STANDARD');

-- 设置数据保留周期
ALTER TABLE table_name SET PROPERTIES('data_retention_days' = '7');
```

***

**注意**：本文档基于 Lakehouse 2025 年 6 月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。

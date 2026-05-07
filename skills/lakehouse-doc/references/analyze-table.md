# 功能

ANALYZE TABLE 语句用于收集指定 schema 中特定表或所有表的统计信息。统计信息包括表的大小、行数等，查询优化器利用这些信息生成最佳的查询计划。虽然这些统计信息可能会随着数据的变化而过时，但查询优化器仍然可以利用这些过时的信息生成有效的查询计划。在 Lakehouse 中，通过执行 DESC 命令获取的统计信息可能存在延迟，因此执行 ANALYZE TABLE 语句可以获取最新的统计信息。

# 语法

```SQL
-- 收集指定表的统计信息
ANALYZE TABLE table_name
   COMPUTE STATISTICS [NOSCAN | FOR COLUMNS col1 , col2... | FOR ALL COLUMNS ]

-- 收集指定schema下所有表的统计信息
ANALYZE TABLES [IN schema_name] COMPUTE STATISTICS [NOSCAN]
```

# 参数

必选参数：

* `table_name`：要收集统计信息的表名称。支持普通表、动态表、物化视图。

可选参数：

* `NOSCAN`：仅收集表的大小（以字节为单位），不需要扫描整个表。
* `FOR COLUMNS col1, col2, ...`：收集每个指定列的列统计信息。
* `FOR ALL COLUMNS`：收集所有列的统计信息。
* `IN schema_name`：指定目标 schema 的名称。如果不指定，则默认使用当前 schema。

# 注意事项

* 在执行 ANALYZE TABLE 语句时，可能会对表进行扫描，因此可能会影响查询性能。建议在系统负载较低时执行此操作。
* 在使用 [实时接口](<java_reference/realtime-upload.md>) 追加模式时，ANALYZE TABLE 语句不会统计未提交的数据，因此 `select count(*) from table` 的结果可能偏少。

# 使用示例

1. 收集指定表的统计信息（不扫描表），仅收集表的大小（以字节为单位）：

```SQL
ANALYZE TABLE sales COMPUTE STATISTICS NOSCAN;
```

2. 收集指定表的列统计信息：

```SQL
ANALYZE TABLE customers COMPUTE STATISTICS FOR COLUMNS customer_id, customer_name;
```

3. 收集指定schema下所有表的统计信息：

```SQL
ANALYZE TABLES IN sales_schema COMPUTE STATISTICS;
```

4. 收集指定表的所有列的统计信息：

```SQL
ANALYZE TABLE orders COMPUTE STATISTICS FOR ALL COLUMNS;
```
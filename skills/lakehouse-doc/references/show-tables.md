## 功能描述
本命令用于查询当前数据库 schema 下的所有表。执行后，将列出所有非视图（view）和非物化视图（materialized view）的表。

## 语法结构
```SQL
SHOW TABLES [IN schema_name] [LIKE 'pattern' | WHERE expr]
```

## 参数详解

1. `IN schema_name`：（可选）指定要查询的 schema 名称。如果未指定，则默认查询当前用户的默认 schema 下的表。
2. `LIKE 'pattern'`：（可选）使用通配符进行模式匹配，只返回匹配指定模式的表名。支持的通配符包括 `%`（匹配任意字符序列）和 `_`（匹配任意单个字符）。注意：`LIKE` 子句不支持与 `WHERE` 子句同时使用。
3. `WHERE expr`：（可选）根据 `SHOW TABLES` 命令显示的字段进行筛选。可以使用字段名和相应的条件表达式进行筛选。

## 使用示例

1.  查询当前 schema 下的所有表：
    ```SQL
   SHOW TABLES;
   ```

2.  查询指定 schema 下的所有表：
    ```SQL
   SHOW TABLES IN my_schema;
   ```

3.  查询当前 schema 下名称中包含 "test" 的表：
    ```SQL
   SHOW TABLES LIKE '%test%';
   ```

4.  查询当前 schema 下的所有非视图表：
    ```SQL
   SHOW TABLES WHERE is_view = false;
   ```

5.  查询当前 schema 下的所有非物化视图表：
    ```SQL
   SHOW TABLES WHERE is_materialized_view = false;
   ```

6.  查询当前 schema 下既不是视图也不是物化视图的表：
    ```SQL
   SHOW TABLES WHERE is_view = false AND is_materialized_view = false AND ;
   ```

## 注意事项
- 当同时使用 `LIKE` 和 `WHERE` 子句时，请确保它们之间的逻辑关系正确。
- 在使用 `LIKE` 子句时，请注意 SQL 通配符的使用规则。
- 在查询指定 schema 时，请确保该 schema 名称的正确性。
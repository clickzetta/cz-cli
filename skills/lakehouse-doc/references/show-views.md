## 功能

本语句用于查看指定 schema 下所有的视图（view）。与 `SHOW TABLES` 语句相似，但通过 WHERE 条件限定，只展示视图。这有助于用户快速了解特定 schema 中的视图结构和信息。

## 语法

```SQL
SHOW TABLES [IN schema_name] [LIKE 'pattern' | WHERE expr]  [LIMIT num]
```

## 参数说明

1. `LIKE pattern`（可选）：按对象名称进行过滤，使用不区分大小写的模式匹配。支持 SQL 通配符 `%`（表示任意字符出现 0 次或多次）和 `_`（表示任意单个字符）。例如：`LIKE '%testing%'`。注意，`LIKE` 子句不能与 `WHERE` 子句同时使用。

2. `IN schema_name`（可选）：指定 schema 名称，用于列举指定 schema 下的视图。如果未指定 schema_name，则展示当前用户的默认 schema 中的视图。

3. `WHERE expr`（可选）：根据 `SHOW TABLES` 语句显示的字段进行筛选。用户可以根据实际需求，使用字段名和相应的条件进行筛选。`LIKE` 和 `WHERE` 不能同时使用。

## 使用示例

1. 查看当前 schema 下所有的视图：

   ```SQL
   SHOW TABLES WHERE is_view=true;
   ```

2. 查看指定 schema（例如：`my_schema`）下所有的视图：

   ```SQL
   SHOW TABLES IN my_schema WHERE is_view=true;
   ```

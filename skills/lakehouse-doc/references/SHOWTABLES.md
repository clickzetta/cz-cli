## 功能描述
本命令用于查询当前数据库schema下的所有表、视图和物化视图的清单。通过使用不同的过滤条件，用户可以快速定位到所需的数据库对象。

## 语法结构
```SQL
SHOW TABLES [IN schema_name] [LIKE 'pattern' | WHERE expr]  [LIMIT num]
```

## 参数详解

1. `LIKE pattern`：此选项为可选参数，用于按对象名称进行过滤。支持不区分大小写的模式匹配，并可使用SQL通配符`%`（表示任意数量的字符）和`_`（表示单个字符）。示例：`LIKE '%testing%'`。需要注意的是，此过滤器不支持与`WHERE`条件同时使用。

2. `IN schema_name`：此选项为可选参数，允许用户指定特定的schema名称，从而列举出该schema下的所有数据库对象。

3. `WHERE expr`：此选项为可选参数，支持用户根据`SHOW TABLES`命令显示的字段进行筛选。用户可以通过表达式对结果进行过滤，以便更精确地查找所需的数据库对象。 支持过滤的字段有
`table_name`、`is_view`、`is_materialized_view`、`is_external`、`is_dynamic`
    ```
       SHOW TABLES WHERE table_name=base_a_dt;
    ```

## 使用示例

1. 查询当前schema下的所有表：
   ```SQL
   SHOW TABLES WHERE is_view=false AND is_materialized_view=false;
   ```

2. 查询指定schema下的所有视图：
   ```SQL
   SHOW TABLES IN my_schema WHERE is_view=true;
   ```

3. 查询当前schema下名称中包含"test"的表和视图：
   ```SQL
   SHOW TABLES LIKE '%test%';
   ```

4. 查询当前schema下的所有物化视图：
   ```SQL
   SHOW TABLES WHERE is_materialized_view=true;
   ```

5. 查询当前schema下的所有动态表：
   ```SQL
   SHOW TABLES WHERE is_dynamic=true;
   ```

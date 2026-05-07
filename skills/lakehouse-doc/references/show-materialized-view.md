## 功能介绍
本命令用于查看指定数据库schema下的所有物化视图。物化视图是一种特殊的数据库对象，它可以预先计算并存储查询结果，以提高查询性能。此命令的功能与SQL语句`SHOW TABLES`相似，但更加灵活，允许用户根据条件进行筛选。

有关更多详细信息，请参阅[物化视图](<MATERIALIZEDVIEW.md>)。

## 语法格式
```SQL
SHOW TABLES [IN schema_name] [LIKE 'pattern' | WHERE expr]  [LIMIT num]
```

## 参数说明
1. `LIKE pattern`：可选参数，用于按对象名称进行过滤。该过滤器使用不区分大小写的模式匹配，并支持SQL通配符`%`（表示任意数量的字符）和`_`（表示单个字符）。例如：`LIKE '%testing%'`。请注意，此参数不支持与`WHERE`条件同时使用。

2. `IN schema_name`：可选参数，用于指定schema名称。通过此参数，用户可以查看指定schema下的所有物化视图。

3. `WHERE expr`：可选参数，允许用户根据`SHOW TABLES`命令显示的字段进行筛选。此参数提供了更灵活的查询方式，可以根据实际需求进行筛选。

## 使用示例

**示例1：查看默认schema下的所有物化视图**
```SQL
SHOW TABLES WHERE is_materialized_view = true;
```

**示例2：查看指定schema下的所有物化视图**
```SQL
SHOW TABLES IN my_schema WHERE is_materialized_view = true;
```

**示例3：查看所有包含"test"字样的物化视图**
```SQL
SHOW TABLES LIKE '%test%' WHERE is_materialized_view = true;
```

**示例4：结合使用`IN`和`LIKE`参数**
```SQL
SHOW TABLES IN my_schema LIKE '%test%' WHERE is_materialized_view = true;
```

## 注意事项
1. 在使用`LIKE`和`WHERE`参数时，请确保过滤条件正确无误，以免返回空结果。
2. 请根据实际需求选择合适的参数进行查询，以提高查询效率。

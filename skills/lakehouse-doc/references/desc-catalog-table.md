## 功能概述

在数据库管理中，了解表的结构是数据分析和数据操作的基础。`DESC TABLE` 命令允许用户查看指定 catalog、schema 和表的详细结构，包括列名、数据类型以及列的描述等信息。

## 语法


```SQL
DESC TABLE catalog_name.schema_name.table_name;
```

### 参数说明

- **catalog_name**: 指定包含目标表的 catalog 名称。
- **schema_name**: 指定包含目标表的 schema 名称。
- **table_name**: 指定要查看结构的表名。



## 示例

```SQL
DESC TABLE my_catalog.my_schema.my_table;
```

上述命令将展示 `my_catalog` 中 `my_schema` 下 `my_table` 表的结构。

## 注意事项

- 用户需要确保在执行命令前已正确指定 catalog、schema 和表的名称。
- 用户需要具备访问指定 catalog、schema 和表的足够权限，否则命令可能因权限不足而失败。
- 目前不支持使用 `USE` 语句直接切换到特定的 catalog，必须使用上述三层命名语法来查询表结构。


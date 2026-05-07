## 功能概述

`SHOW TABLES IN CATALOG` 是一个 SQL 命令，用于列出指定 catalog 和 schema 中的所有表。

## 语法

```SQL
SHOW TABLES IN catalog_name.schema_name;
```

### 参数说明

* **catalog_name**: 指定要列出表的 catalog 的名称。必须确保提供的 catalog 名称在系统中存在且可访问。
* **schema_name**: 指定要列出表的 schema 的名称。该 schema 必须属于上述 catalog。

## 示例

```SQL
SHOW TABLES IN my_catalog.my_schema;
```

上述命令将列出名为 `my_catalog` 的 catalog 和 `my_schema` 的 schema 中定义的所有表。

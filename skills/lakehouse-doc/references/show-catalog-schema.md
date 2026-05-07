## 功能概述

`SHOW SCHEMAS IN CATALOG` 是一个 SQL 命令，用于展示指定 catalog 中定义的所有 schema 的列表。Schema 通常用于按照逻辑分组来组织数据库中的表和视图。

## 语法

```SQL
SHOW SCHEMAS [EXTENDED] IN catalog_name;
```

### 参数说明

* **catalog_name**: 指定要列出 schema 的 catalog 名称。用户必须确保提供的 catalog 名称在系统中存在且可访问。
* **EXTENDED**: （可选）展示更多详细信息。

## 示例

### 示例一

```SQL
SHOW SCHEMAS IN my_catalog;
+---------------------------------------------------------------------------+
|                                schema_name                                |
+---------------------------------------------------------------------------+
| air_travel                                                                |
| all_data                                                                  |
| automobile                                                                |
| automv_schema                                                             |
| bigquant                                                                  |
+---------------------------------------------------------------------------+
```

### 示例二

```SQL
SHOW SCHEMAS  EXTENDED IN my_catalog;
+---------------------------------------------------------------------------+----------+
|                                schema_name                                |   type   |
+---------------------------------------------------------------------------+----------+
| air_travel                                                                | managed  |
| all_data                                                                  | managed  |
| automobile                                                                | managed  |
| external_hive_schema                                                      | external |
+---------------------------------------------------------------------------+----------+

```

^

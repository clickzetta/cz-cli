## 功能概述

`DESC CATALOG` 是一个 SQL 命令，用于显示有关特定 catalog 的详细信息。使用此命令，用户可以获取关于 catalog 的详细描述，包括其创建时间、创建者等信息。

## 语法

```SQL
DESC  CATALOG [EXTENDED] catalog_name;
```

### 参数说明

* **catalog_name**: 要描述的 catalog 的名称。用户必须确保提供的 catalog 名称在系统中存在且可访问。

## 示例

```SQL
DESC CATALOG test_external_catalog;
+--------------------+------------------------+
|     info_name      |       info_value       |
+--------------------+------------------------+
| name               | test_external_catalog  |
| creator            | UAT_TEST               |
| created_time       | 2024-06-27 18:05:36.69 |
| last_modified_time | 2024-06-27 18:05:36.69 |
| comment            |                        |
+--------------------+------------------------+

```

^

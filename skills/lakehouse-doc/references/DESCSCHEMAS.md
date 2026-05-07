## 功能概述

`DESCRIBE` 或 `DESC` 命令用于展示指定数据库架构（SCHEMA）的属性信息。掌握这个命令对于理解数据库架构的结构和元数据至关重要。通过使用 `EXTENDED` 关键字，用户可以获得更详尽的信息，如权限设置、创建时间等。

## 语法结构

```SQL
DESCRIBE  SCHEMA [EXTENDED] schema_name;
```

## 参数详解

* `DESCRIBE` / `DESC`：这两个关键字在本命令中可互换使用，用于查询数据库架构的属性。
* `EXTENDED`：这是一个可选关键字，用于展示更详细的信息，如权限、创建时间等。
* `schema_name`：指定需要查询属性的数据库架构名称。

## 使用示例

以下是 `DESCRIBE` 命令的一些使用示例：

1. 查询名为 `ods_schema` 的数据库架构的基本属性信息：

   ```SQL
   DESCRIBE SCHEMA ods_schema;
   ```

2. 查询名为 `ods_schema` 的数据库架构的详细属性信息，包括创建者、创建时间、修改时间和权限设置：

   ```SQL
   DESCRIBE  SCHEMA EXTENDED ods_schema;
   ```

## 预期输出结果

执行 `DESCRIBE  SCHEMA EXTENDED ods_schema;` 命令后，预期的输出结果可能如下：

```Plain
+---------------------+-------------------------+
|      info_name      |       info_value        |
+---------------------+-------------------------+
| name                | testshareschema         |
| creator             | UAT_TEST                |
| created_time        | 2023-12-20 22:54:17.162 |
| last_modified_time  | 2023-12-20 22:54:17.162 |
| comment             |                         |
| properties          | ()                      |
| type                | shared                  |
| origin_share_schema | public                  |
| origin_share        | billing.testshareschema |
+---------------------+-------------------------+
```

在这个输出结果中，用户不仅可以看到数据库架构的基本信息，还可以了解到创建者、创建时间、最后修改时间等详细信息。

## 权限要求

执行 DESC\[RIBE] SCHEMA 语句的用户必须拥有查询指定 SCHEMA 属性的权限。

通过 DESC\[RIBE] SCHEMA 命令，用户可以详细了解 SCHEMA 的配置和状态，这对于数据库管理和维护至关重要。确保在执行此命令前，您已经获得了必要的权限。

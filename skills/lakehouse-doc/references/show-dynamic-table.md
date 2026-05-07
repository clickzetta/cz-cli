# 列出动态表命令功能文档

## 功能概述

`SHOW TABLES` 是一个 SQL 命令，用于展示数据库中所有表的列表。当结合条件 `WHERE is_dynamic=true` 时，此命令可用于列出所有动态表。

## 语法

### 基本语法

```SQL
SHOW TABLES [IN schema_name] WHERE is_dynamic=true [LIMIT num];
```

### 参数说明

* **schema_name**: (可选) 指定要列出其中表的 schema 名称。如果指定，命令将只列出指定 schema 中的动态表。
* **is\_dynamic**: 一个布尔值条件，用于筛选动态表。

## 示例

列出所有动态表

```SQL
SHOW TABLES WHERE is_dynamic=true;
+-------------+--------------+---------+----------------------+-------------+------------+
| schema_name |  table_name  | is_view | is_materialized_view | is_external | is_dynamic |
+-------------+--------------+---------+----------------------+-------------+------------+
| public      | aa           | false   | false                | false       | true       |
| public      | base_a_dt    | false   | false                | false       | true       |
| public      | base_a_dt01  | false   | false                | false       | true       |
| public      | change_table | false   | false                | false       | true       |
| public      | dt_agg       | false   | false                | false       | true       |
| public      | dt_line      | false   | false                | false       | true       |
| public      | dt_tran      | false   | false                | false       | true       |
+-------------+--------------+---------+----------------------+-------------+------------+

```

列出特定 schema 下的所有动态表

```SQL
SHOW TABLES IN public WHERE is_dynamic=true;
+-------------+--------------+---------+----------------------+-------------+------------+
| schema_name |  table_name  | is_view | is_materialized_view | is_external | is_dynamic |
+-------------+--------------+---------+----------------------+-------------+------------+
| public      | aa           | false   | false                | false       | true       |
| public      | base_a_dt    | false   | false                | false       | true       |
| public      | base_a_dt01  | false   | false                | false       | true       |
| public      | change_table | false   | false                | false       | true       |
| public      | dt_agg       | false   | false                | false       | true       |
| public      | dt_line      | false   | false                | false       | true       |
| public      | dt_tran      | false   | false                | false       | true       |
+-------------+--------------+---------+----------------------+-------------+------------+
```

使用 WHERE 条件过滤

```
SHOW TABLES IN public WHERE table_name='aa';
+-------------+------------+---------+----------------------+-------------+------------+
| schema_name | table_name | is_view | is_materialized_view | is_external | is_dynamic |
+-------------+------------+---------+----------------------+-------------+------------+
| public      | aa         | false   | false                | false       | true       |
+-------------+------------+---------+----------------------+-------------+------------+
```

^

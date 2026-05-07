## 功能描述

`SHOW TABLES HISTORY` 命令用于查看表的历史记录，包括已删除表的删除时间。对于未删除的表，删除时间将显示为 null。此功能特别适用于通过 UNDROP 恢复误删的表。

## 语法格式

```
SHOW TABLES HISTORY [IN schema_name] [LIKE 'pattern' ] [WHERE <expression>]
```

## 参数说明

* `LIKE pattern`: 可选参数，用于按照对象名称进行过滤。支持不区分大小写的模式匹配，可以使用 SQL 通配符 `%` 和 `_`。注意，此参数不支持与 WHERE 子句同时使用。
* `IN schema_name`: 可选参数，用于指定 schema 名称，从而列举指定 schema 下的表历史记录。
* `WHERE <expression>`（可选，与LIKE二选一）：支持根据命令显示的字段进行筛选，可以使用表达式对结果进行复杂过滤

## 使用示例

**示例 1：查看表历史记录**

```SQL
SHOW TABLES HISTORY;
+-------------+------------------------------------------+-------------------------+-------------+----------+------------+---------+----------------+-------------------------+
| schema_name |                table_name                |       create_time       |   creator   |   rows   |   bytes    | comment | retention_time |       delete_time       |
+-------------+------------------------------------------+-------------------------+-------------+----------+------------+---------+----------------+-------------------------+
| public      | mv                                       | 2024-12-13 09:34:26.683 | UAT_TEST    | 4        | 2467       |         | 1              |                         |
| public      | mv_base_a                                | 2024-12-13 09:34:05.076 | UAT_TEST    | 4        | 1970       |         | 1              |                         |
| public      | mv_base_a                                | 2023-09-22 03:41:28.011 | UAT_TEST    | 5        | 1406       |         | 1              | 2024-12-13 09:34:04.946 |
+-------------+------------------------------------------+-------------------------+-------------+----------+------------+---------+----------------+-------------------------+
```

执行该命令将列出当前数据库中所有表的历史记录。

**示例 2：按照 schema 查看表历史记录**

```SQL
SHOW TABLES HISTORY IN my_schema;
```

该命令将只显示 `my_schema` schema 下的表历史记录。

**示例 3：过滤特定模式的表历史记录**

```SQL
SHOW TABLES HISTORY LIKE '%test%';
```

此命令将列出名称中包含 "test" 的表历史记录。

**示例 4：恢复误删的表**

```SQL
-- 创建表并插入数据
CREATE TABLE mytable (id INT, name STRING);
INSERT INTO mytable VALUES (1, 'aaa');

-- 删除表
DROP TABLE mytable;

-- 查看表删除记录
SHOW TABLES HISTORY;

-- 恢复表
UNDROP TABLE mytable;
```

**示例 5：删除表后创建同名的表并尝试恢复**

```SQL
-- 创建表并插入数据
CREATE TABLE mytable (id INT, name STRING);
INSERT INTO mytable VALUES (1, 'aaa');

-- 删除表
DROP TABLE mytable;

-- 查看表删除记录
SHOW TABLES HISTORY;

-- 重复建表
CREATE TABLE mytable (col1 INT, col12 STRING);

-- 查看表删除记录，未删除的表 delete_time 是 null
SHOW TABLES HISTORY;

-- 重命名未删除的表
ALTER TABLE mytable RENAME TO mytable_back;

-- 恢复表
UNDROP TABLE mytable;
```

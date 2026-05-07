# UNDROP TABLE 语句

使用 UNDROP TABLE 语句可以恢复被删除的表、动态表和物化视图。是否可以恢复被删除的对象取决于数据的[保留周期](TIMETRAVEL.md)。

**数据保留周期**

对象能否被恢复取决于数据的保留周期。当前预览版本的数据保留周期默认为 7 天，未来将调整为 1 天。您可以通过执行 [ALTER 命令](alter.md) 来调整保留周期。请注意，修改保留周期可能会增加存储成本。

**支持的对象类型**：

* 表（TABLE）
* 动态表（DYNAMIC TABLE）
* 物化视图（MATERIALIZED VIEW）

## 语法

```sql
UNDROP TABLE tablename;
```

## 参数说明

* **tablename**：指定被删除的表的名称。支持恢复动态表、内部表、物化视图。

## 示例

### 示例 1：删除表后立即恢复

```sql
-- 创建表
CREATE TABLE mytable(id int, name string);
INSERT INTO mytable VALUES(1, 'aaa');
-- 删除表
DROP TABLE mytable;
-- 查看表删除记录，可以看到删除时间
SHOW TABLES HISTORY;
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| schema_name  | table_name | create_time            | creator  | rows | bytes | comment | retention_time | delete_time             |
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| undrop_schema | mytable    | 2023-06-06 12:22:57.642 | UAT_TEST | 1    | 1348  |         | 1              | 2023-07-18 17:49:26.374 |
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
-- 恢复表
UNDROP TABLE mytable;
```

### 示例 2：删除表后创建同名表再恢复

```sql
-- 创建表
CREATE TABLE mytable(id int, name string);
INSERT INTO mytable VALUES(1, 'aaa');
-- 删除表
DROP TABLE mytable;
-- 查看表删除记录
SHOW TABLES HISTORY;
-- 重复建表
CREATE TABLE mytable(col1 int, col2 string);
-- 查看表删除记录，未删除的表delete_time是null
SHOW TABLES HISTORY;
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| schema_name  | table_name | create_time            | creator  | rows | bytes | comment | retention_time | delete_time             |
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| undrop_schema | mytable    | 2023-07-18 17:51:25.978 | UAT_TEST | 0    | 0     |         | 1              |                          |
| undrop_schema | mytable    | 2023-06-06 12:22:57.642 | UAT_TEST | 1    | 1348  |         | 1              | 2023-07-18 17:49:26.374 |
+---------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
-- 重命名未删除的表
ALTER TABLE mytable RENAME TO mytable_back;
-- 恢复表
UNDROP TABLE mytable;
```

### 示例 3：恢复动态表

```sql
-- 创建一个基表
DROP TABLE IF EXISTS dy_base_a;
CREATE TABLE dy_base_a (i int, j int);
INSERT INTO dy_base_a VALUES
(1, 10),
(2, 20),
(3, 30),
(4, 40);
-- 使用dynamic table进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;
CREATE DYNAMIC TABLE change_table
(i, j)
AS SELECT * FROM dy_base_a;
-- 刷新dynamic table
REFRESH DYNAMIC TABLE change_table;
-- 查询数据
SELECT * FROM change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
DROP DYNAMIC TABLE IF EXISTS change_table;
UNDROP TABLE change_table;
SELECT * FROM change_table;
```

### 示例 4：恢复物化视图

```SQL
DROP TABLE IF EXISTS mv_base_a;
DROP MATERIALIZED VIEW IF EXISTS mv1;

-- 创建一个基表
CREATE TABLE mv_base_a (i int, j int);

INSERT INTO mv_base_a
VALUES (1, 10),
       (2, 20),
       (3, 30),
       (4, 40);

-- 创建物化视图
CREATE MATERIALIZED VIEW mv1 (i, j) AS
SELECT *
FROM mv_base_a;

-- 刷新物化视图
REFRESH MATERIALIZED VIEW mv1;

-- 查询数据
SELECT * FROM mv1;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
DROP MATERIALIZED VIEW mv1;
SHOW TABLES HISTORY WHERE table_name = 'mv1';
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| schema_name | table_name |       create_time       | creator  | rows | bytes | comment | retention_time |       delete_time       |
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| public      | mv1        | 2024-12-18 16:57:35.916 | UAT_TEST | 4    | 2467  |         | 1              | 2024-12-18 16:57:58.427 |
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
UNDROP TABLE mv1;

SELECT * FROM mv1;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
```

## 注意事项

* 请确保在数据保留周期内进行恢复操作，否则无法恢复被删除的对象。
* 在恢复对象之前，请确保没有同名的对象存在。如有同名对象，请先重命名或删除该同名对象。



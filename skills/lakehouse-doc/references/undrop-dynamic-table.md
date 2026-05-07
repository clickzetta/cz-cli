# UNDROP TABLE 语句

使用 UNDROP TABLE 语句可以恢复被删除的表、动态表和物化视图。是否可以恢复被删除的对象依赖于数据的[保留周期](<TIMETRAVEL.md>)。
**数据保留周期**：
对象的历史恢复能力取决于数据的保留周期。当前默认保留周期为1天。您可以通过执行[ALTER命令](TIMETRAVEL.md)来调整保留周期。请注意，修改保留周期可能会增加存储成本。支持表（TABLE）和动态表（DYNAMIC TABLE）不支持物化视图

## 语法

```sql
UNDROP TABLE tablename;
```

## 参数说明

- **tablename**：指定被删除的表的名字。支持动态表、内部表、物化视图。

## 示例
### 示例 1：恢复动态表

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
### 示例 2：删除表后创建同名的表恢复

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

## 注意事项

- 请确保在数据保留周期内进行恢复操作，否则无法恢复被删除的表。
- 在恢复表之前，请确保没有同名的表存在。如有同名表，请先重命名或删除同名表。

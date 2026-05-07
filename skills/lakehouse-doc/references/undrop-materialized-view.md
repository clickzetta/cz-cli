# UNDROP TABLE

使用 UNDROP TABLE 语句可以恢复被删除的表、动态表和物化视图。因此本文使用UNDROP TABLE 来恢复删除的物化视图，是否可以恢复被删除的对象依赖于数据的[保留周期](TIMETRAVEL.md)。
**数据保留周期**：
对象的历史恢复能力取决于数据的保留周期。当前预览版本的数据保留周期默认为7天，未来将调整为1天。您可以通过执行[ALTER命令](TIMETRAVEL.md)来调整保留周期。请注意，修改保留周期可能会增加存储成本。支持表（TABLE）、动态表（DYNAMIC TABLE）和物化视图

## 语法

```sql
UNDROP TABLE tablename;
```

## 参数说明

* **tablename**：指定被删除的表的名字。支持动态表、内部表、物化视图。

### 示例 1：恢复物化视图

```SQL
DROP      TABLE mv_base_a;

DROP MATERIALIZED VIEW mv1;

--创建一个基表
CREATE    TABLE mv_base_a (i int, j int);

INSERT    INTO mv_base_a
VALUES    (1, 10),
          (2, 20),
          (3, 30),
          (4, 40);

--使用dynamic table进行加工
CREATE MATERIALIZED VIEW mv1 (i, j) AS
SELECT    *
FROM      mv_base_a;

--刷新dynamic table
REFRESH   MATERIALIZED VIEW mv1;

--查询数据
SELECT    *
FROM      mv1;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
DROP materialized VIEW mv1;

SHOW      TABLES history
WHERE     table_name = 'mv1';
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| schema_name | table_name |       create_time       | creator  | rows | bytes | comment | retention_time |       delete_time       |
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
| public      | mv1        | 2024-12-18 16:57:35.916 | UAT_TEST | 4    | 2467  |         | 1              | 2024-12-18 16:57:58.427 |
+-------------+------------+-------------------------+----------+------+-------+---------+----------------+-------------------------+
UNDROP TABLE mv1;

SELECT    *
FROM      mv1;
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

* 请确保在数据保留周期内进行恢复操作，否则无法恢复被删除的表。
* 在恢复表之前，请确保没有同名的表存在。如有同名表，请先重命名或删除同名表。

^

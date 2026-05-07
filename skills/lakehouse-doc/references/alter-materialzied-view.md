# 修改物化视图
支持使用 ALTER 语句对 MATERIALIZED VIEW 进行运维管理，包括暂停和启动由 Lakehouse 系统刷新的调度任务。当创建 MATERIALIZED VIEW 时，使用 refreshOption 语法，可以通过以下语句来控制任务的执行状态。

有关更多详细信息，请参阅[物化视图](<MATERIALIZEDVIEW.md>)。

## 功能说明
Lakehouse 系统支持使用 `ALTER` 语句对物化视图进行运维管理：
* **暂停和启动调度任务**：控制由 Lakehouse 系统自动刷新的调度任务。
* **表注释**：更新物化视图的描述信息。
* **列名**：修改现有列的名称。

对于涉及 **SQL 查询逻辑变化** 的修改（即物化视图定义中的 `SELECT` 加工过程），必须使用 `CREATE OR REPLACE` 语法。这是因为动态表与普通表不同，其定义包含了数据加工逻辑，而不仅仅是静态结构。以下修改需要使用 CREATE OR REPLACE 语法：
* **调度周期**：调整调度任务的执行频率。
* **计算集群**：指定用于处理物化视图的计算资源。
* **增加列**：物化视图增加列，涉及到SQL语法结构变化。
* **减列**：物化视图删除列，涉及 SQL 语法结构变化。
* **修改列类型**：涉及 SQL 语法结构变化。
* **修改物化视图中 SQL 语法定义**：涉及 SQL 语法结构变化。


# 语法

## 暂停 Lakehouse 系统刷新的调度任务

```
-- 暂停Lakehouse系统刷新的调度任务
ALTER MATERIALIZED VIEW dt_name SUSPEND;
```

## 启动 Lakehouse 系统刷新的调度任务

```
-- 启动Lakehouse系统刷新的调度任务
ALTER MATERIALIZED VIEW mv_name RESUME;
```

## 修改表的注释（comment）

```SQL
-- 修改表的comment
ALTER TABLE mv_name SET COMMENT 'comment';
```

## 修改物化视图中列的名称

```
ALTER TABLE mv_name RENAME COLUMN column_name TO new_column_name;
```

## 案例

```
ALTER TABLE change_table  RENAME COLUMN i TO ii;
```

## 修改物化视图中列的注释（comment）

```
ALTER TABLE table_name CHANGE COLUMN column_name_identifier COMMENT 'comment'
```

## 案例

```
ALTER TABLE change_table  CHANGE COLUMN ii COMMENT 'comment';
```
## 修改表的属性

功能：通过 ALTER TABLE 命令，您可以为外部表设置或修改属性。目前为保留参数。

语法：

```
ALTER TABLE table_name SET PROPERTIES("key"="value");
```

## 修改调度周期

```SQL
--原表
CREATE MATERIALIZED VIEW  mv_table
REFRESH interval 10 minute vcluster default
AS select * from student02;
--修改后
CREATE OR REPLACE MATERIALIZED VIEW  mv_table
BUILD DEFERRED
REFRESH
interval 20 minute vcluster default
DISABLE QUERY REWRITE
AS select * from student02;

--修改计算集群
--原表
CREATE MATERIALIZED VIEW  mv_table
REFRESH
interval 10 minute vcluster default
AS select * from student02;
--修改后
CREATE OR REPLACE MATERIALIZED VIEW  mv_table
BUILD DEFERRED 
REFRESH interval 10 minute vcluster alter_vc
DISABLE QUERY REWRITE
AS select * from student02;
```

## 增加列

```SQL
--创建一个基表
DROP TABLE  IF EXISTS mv_base_a;
CREATE TABLE mv_base_a (i int, j int);
INSERT INTO mv_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW   IF EXISTS mv_table;
CREATE  MATERIALIZED VIEW mv_table
(i,j)
AS select * from mv_base_a;
--刷新MATERIALIZED VIEW
refresh MATERIALIZED VIEW mv_table;
--查询数据
select * from mv_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
--添加一列col
CREATE OR REPLACE MATERIALIZED VIEW mv_table
(i,j,col)
BUILD DEFERRED DISABLE QUERY REWRITE
AS select i,j,j*1 from mv_base_a;
--下次刷新会进行全量刷新，因为新增了加工逻辑
refresh MATERIALIZED VIEW mv_table;
SELECT * FROM mv_table;
+---+----+-----+
| i | j  | col |
+---+----+-----+
| 1 | 10 | 10  |
| 2 | 20 | 20  |
| 3 | 30 | 30  |
| 4 | 40 | 40  |
+---+----+-----+
```

## 减列

```SQL
DROP TABLE  IF EXISTS mv_base_a;
CREATE TABLE mv_base_a (i int, j int);
INSERT INTO mv_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW  IF EXISTS mv_table;
CREATE  MATERIALIZED VIEW mv_table
(i,j)
AS select * from mv_base_a;
--刷新MATERIALIZED VIEW
refresh MATERIALIZED VIEW mv_table;
--查询数据
select  * from mv_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
--物化视图修改：减列
CREATE OR REPLACE MATERIALIZED VIEW mv_table
(i,j)
BUILD DEFERRED DISABLE QUERY REWRITE
AS select i,j from mv_base_a;
--此时表中查询会少一列，刷新为增量刷新。
select * from mv_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
```

## 修改 SQL 语法定义

```SQL
--创建一个基表
DROP TABLE  IF EXISTS mv_base_a;
CREATE TABLE mv_base_a (i int, j int);
INSERT INTO mv_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW  IF EXISTS mv_table;
CREATE MATERIALIZED VIEW mv_table
(i,j)
AS select * from mv_base_a;
--刷新MATERIALIZED VIEW
refresh MATERIALIZED VIEW mv_table;
--查询数据
select * from mv_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
--修改where过滤条件
CREATE OR REPLACE MATERIALIZED VIEW mv_table
(i,j)
BUILD DEFERRED DISABLE QUERY REWRITE
AS select * from mv_base_a where i>3;
--此时刷新会全量刷新一次
refresh MATERIALIZED VIEW mv_table;
select * from mv_table;
+---+----+
| i | j  |
+---+----+
| 4 | 40 |
+---+----+
```


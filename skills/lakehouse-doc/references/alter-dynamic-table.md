# 修改dynamic table

Lakehouse 系统支持使用 `ALTER` 语句对动态表进行运维管理：

* **暂停和启动调度任务**：控制由 Lakehouse 系统自动刷新的调度任务。
* **表注释**：更新动态表的描述信息。
* **列名**：修改现有列的名称。

对于涉及 **SQL 查询逻辑变化** 的修改（即动态表定义中的 `SELECT` 加工过程），必须使用 `CREATE OR REPLACE` 语法。这是因为动态表与普通表不同，其定义包含了数据加工逻辑，而不仅仅是静态结构。以下需要使用CREATE OR REPLACE 语法修改。需要注意的是，如果用户不是简单的删除列/添加列（添加列定义：只能是从表一路经由 SELECT 透传的，不能参与任何会影响其他列的计算，例如 join key、group key 等），则在 CREATE OR REPLACE 发生后，REFRESH 任务会退化为一次全量刷新。

* **调度周期**：调整调度任务的执行频率。
* **计算集群**：指定用于处理动态表的计算资源。
* **增加列**：动态表增加列，涉及到SQL语法结构变化。
* **减列**：动态表减列，涉及到SQL语法结构变化。
* **修改列类型**：涉及到SQL语法结构变化。
* **修改动态表中SQL语法定义**：涉及到SQL语法结构变化。

# 语法

## 暂停Lakehouse系统刷新的调度任务

```
-- 暂停Lakehouse系统刷新的调度任务
ALTER DYNAMIC TABLE dt_name SUSPEND;
```

## 启动Lakehouse系统刷新的调度任务

```
-- 启动Lakehouse系统刷新的调度任务
ALTER DYNAMIC TABLE dt_name RESUME;
```

## 修改表的注释（COMMENT）

```SQL
-- 修改表的comment
ALTER DYNAMIC TABLE dt_name SET COMMENT 'comment';
```

## 修改动态表中列的名称

```
ALTER DYNAMIC TABLE dt_name RENAME COLUMN column_name TO new_column_name;
```

示例

```
ALTER DYNAMIC TABLE change_table  RENAME COLUMN i TO ii;
```

## 修改动态表中列的注释（COMMENT）

```
ALTER DYNAMIC TABLE table_name CHANGE COLUMN column_name_identifier COMMENT 'comment'
```

案例

```
ALTER DYNAMIC TABLE change_table  CHANGE COLUMN ii COMMENT 'comment';
```

## 修改表的属性（PROPERTIES）

功能：通过 ALTER DYNAMIC TABLE 命令，您可以为动态表设置或修改属性。目前为保留参数。

语法：

```
--为动态表设置或修改属性
ALTER DYNAMIC TABLE dt_name SET PROPERTIES("key"="value");
--删除属性
ALTER DYNAMIC TABLE dt_name SET PROPERTIES("key");
```
案例
```
--增加属性
ALTER DYNAMIC TABLE dt_name set properties('aa'='bb');
--修改属性
ALTER DYNAMIC TABLE dt_name set properties('aa'='cc');
--删除属性
ALTER DYNAMIC TABLE dt_name unset properties('aa');

```

## 修改调度周期

使用 CREATE OR REPLACE 语法，示例如下

```
--原表
CREATE dynamic TABLE dt_name
REFRESH   interval 10 MINUTE vcluster DEFAULT AS
SELECT    *
FROM      student02;

--修改后
CREATE OR  REPLACE dynamic TABLE dt_name
REFRESH   interval 20 MINUTE vcluster DEFAULT AS
SELECT    *
FROM      student02;
```

## 修改计算集群

使用 CREATE OR REPLACE 语法，示例如下

```
--原表
CREATE dynamic TABLE dt_name
REFRESH   interval 10 MINUTE vcluster DEFAULT AS
SELECT    *
FROM      student02;

--修改后
CREATE OR   REPLACE dynamic TABLE dt_name
REFRESH   interval 10 MINUTE vcluster alter_vc AS
SELECT    *
FROM      student02;
```

## 增加列

```SQL
--创建一个基表
DROP TABLE  IF EXISTS dy_base_a;
CREATE TABLE dy_base_a (i int, j int);
INSERT INTO dy_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用dynamic table进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;

CREATE DYNAMIC TABLE change_table (i, j) AS
SELECT    *
FROM      dy_base_a;

--刷新dynamic table
REFRESH   DYNAMIC TABLE change_table;

--查询数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+

--添加一列col
CREATE OR REPLACE DYNAMIC TABLE change_table (i, j, col) AS
SELECT    i,
          j,
          j * 1
FROM      dy_base_a;

--下次刷新会进行全量刷新，因为新增了加工逻辑
REFRESH   DYNAMIC TABLE change_table;
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

```
DROP      TABLE IF EXISTS dy_base_a;

CREATE    TABLE dy_base_a (i int, j int);

INSERT    INTO dy_base_a
VALUES    (1, 10),
          (2, 20),
          (3, 30),
          (4, 40);

--使用dynamic table进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;

CREATE DYNAMIC TABLE change_table (i, j) AS
SELECT    *
FROM      dy_base_a;

--刷新dynamic table
REFRESH   DYNAMIC TABLE change_table;

--查询数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+

--减列
CREATE OR REPLACE DYNAMIC TABLE change_table (i, j) AS
SELECT    i,
          j
FROM      dy_base_a;

--此时表中查询会少一列，刷新为增量刷新。
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+
```

## 修改SQL语法定义

```SQL
--创建一个基表
DROP      TABLE IF EXISTS dy_base_a;

CREATE    TABLE dy_base_a (i int, j int);

INSERT    INTO dy_base_a
VALUES    (1, 10),
          (2, 20),
          (3, 30),
          (4, 40);
--使用dynamic table进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;

CREATE DYNAMIC TABLE change_table (i, j) AS
SELECT    *
FROM      dy_base_a;

--刷新dynamic table
REFRESH   DYNAMIC TABLE change_table;
--查询数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+

--修改where过滤条件
CREATE OR  REPLACE DYNAMIC TABLE change_table (i, j) AS
SELECT    *
FROM      dy_base_a
WHERE     i > 3;

--此时刷新会全量刷新一次
REFRESH   DYNAMIC TABLE change_table;

SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 4 | 40 |
+---+----+


```

## 修改列类型

如果是兼容类型例如int变成bigint。具体兼容类型可以[参考修改列类型](ALTER-TABLE-COLUMN.md)则会增量刷新

```SQL
--创建一个基表
DROP      TABLE IF EXISTS dy_base_a;

CREATE    TABLE dy_base_a (i int, j int);

INSERT    INTO dy_base_a
VALUES    (1, 10),
          (2, 20),
          (3, 30),
          (4, 40);

--使用dynamic table进行加工
DROP DYNAMIC TABLE IF EXISTS change_table;

CREATE DYNAMIC TABLE change_table (i, j) AS
SELECT    *
FROM      dy_base_a;

--刷新dynamic table
REFRESH   DYNAMIC TABLE change_table;

--查询数据
SELECT    *
FROM      change_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+

--修改列类型，
CREATE OR  REPLACE DYNAMIC TABLE change_table (i, j) AS
SELECT    cast(i AS bigint),
          j
FROM      dy_base_a;

REFRESH   DYNAMIC TABLE change_table;

DESC change_table;
+-------------+-----------+---------+
| column_name | data_type | comment |
+-------------+-----------+---------+
| i           | bigint    |         |
| j           | int       |         |
+-------------+-----------+---------+

```

## 使用示例

1. 暂停名为 "dynamic_sales" 的动态表的调度任务：

```SQL
ALTER DYNAMIC TABLE dynamic_sales SUSPEND;
```

2. 启动名为 "dynamic_inventory" 的动态表的调度任务：

```SQL
ALTER DYNAMIC TABLE dynamic_inventory RESUME;
```

3. 对于设置过 refreshOption 的动态表 dt_name，修改刷新任务使用的计算资源

```SQL
CREATE dynamic TABLE dt_name
REFRESH   interval 10 MINUTE vcluster DEFAULT AS
SELECT    *
FROM      student02;

CREATE OR  REPLACE dynamic TABLE dt_name
REFRESH   interval 10 MINUTE vcluster alter_vc AS
SELECT    *
FROM      student02;
```

4. 修改已有的动态表注释（COMMENT）

```
ALTER DYNAMIC TABLE bulk_order_items_dt SET COMMENT 'comment';
```

^

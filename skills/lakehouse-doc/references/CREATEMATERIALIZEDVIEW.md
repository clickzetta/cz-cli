# 物化视图创建与使用

## 功能介绍

根据现有表的查询，在当前指定的Schema中创建一个新的物化视图，并用查询数据填充视图。

有关更多详细信息，请参阅[物化视图](MATERIALIZEDVIEW.md)。

## 语法说明

```SQL
CREATE [OR REPLACE | IF NOT EXISTS] MATERIALIZED VIEW mv_name
[ (column_list) ] 
[CLUSTERED BY (column_name)]
[PARTITIONED BY (column_name)]
[ COMMENT view_comment ] 
[BUILD DEFERRED|BUILD IMMEDIATE]
[refreshOption]
[DISABLE QUERY REWRITE]
AS <query>;  

refreshOption ::=
    REFRESH 
    [START WITH timestamp_expr]  [interval_time] VCLUSTER vcname
```

**必需参数**

1. mv_name: 指定物化视图名称。
2. AS query：物化视图所包含的查询语句。

**可选参数**

1. IF NOT EXISTS:可选，如果指定的物化视图名字存在，系统不会报错，但是物化视图不会创建成功。不能和OR REPLACE同时使用

2. OR REPLACE:在传统数据库中，此选项用于在同一个事务内用新对象替换旧对象，并删除旧对象的数据。但在Lakehouse中，为了支持物化视图的增加、删除和修改操作，我们保留了数据以及元数据权限信息。这意味着，即使在修改表结构或SQL逻辑时，原有数据也不会丢失。此功能特别适用于添加或删除列、调整SQL处理逻辑以及变更数据类型。请注意您修改时必须使用BUILD DEFERRED ...DISABLE QUERY REWRITE语法，该语法则会禁用物化视图重写功能，如果用户不是简单的 删除列 / 添加列 添加列定义：只能是从表一路经由SELECT透传的，不能参与任何会影响其他列的计算例如 join key, group key 等
则在 Create Or Replace 发生后，REFRESH任务会退化为一次全量刷新。如果您想体验增量计算功能请使用[DYNAMIC TABLE](dynamic-table-introduce.md)

```
  --修改调度周期
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

--增加列
--创建一个基表
DROP TABLE  IF EXISTS mv_base_a;
CREATE TABLE mv_base_a (i int, j int);
INSERT INTO mv_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW IF EXISTS mv_table;

CREATE MATERIALIZED VIEW mv_table (i, j) AS
SELECT    *
FROM      mv_base_a;

--刷新MATERIALIZED VIEW
REFRESH   MATERIALIZED VIEW mv_table;

--查询数据
SELECT * FROM mv_table;
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
(i, j, col) 
BUILD DEFERRED DISABLE QUERY REWRITE AS
SELECT    i,
          j,
          j * 1
FROM      mv_base_a;

--下次刷新会进行全量刷新，因为新增了加工逻辑
REFRESH   MATERIALIZED VIEW mv_table;
SELECT    *
FROM      mv_table;
+---+----+-----+
| i | j  | col |
+---+----+-----+
| 1 | 10 | 10  |
| 2 | 20 | 20  |
| 3 | 30 | 30  |
| 4 | 40 | 40  |
+---+----+-----+

--减列
DROP      TABLE IF EXISTS mv_base_a;

CREATE    TABLE mv_base_a (i int, j int);

INSERT    INTO mv_base_a
VALUES    (1, 10),
          (2, 20),
          (3, 30),
          (4, 40);

--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW IF EXISTS mv_table;

CREATE MATERIALIZED VIEW mv_table (i, j) AS
SELECT    *
FROM      mv_base_a;

--刷新MATERIALIZED VIEW
REFRESH   MATERIALIZED VIEW mv_table;

--查询数据
SELECT    *  FROM      mv_table;
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
(i, j) 
BUILD DEFERRED DISABLE QUERY REWRITE AS
SELECT    i,
          j
FROM      mv_base_a;

--此时表中查询会少一列，刷新为增量刷新。
SELECT    *
FROM      mv_table;
+---+----+
| i | j  |
+---+----+
| 1 | 10 |
| 2 | 20 |
| 3 | 30 |
| 4 | 40 |
+---+----+

--修改SQL语法定义
--创建一个基表
DROP TABLE  IF EXISTS mv_base_a;
CREATE TABLE mv_base_a (i int, j int);
INSERT INTO mv_base_a VALUES
(1,10),
(2,20),
(3,30),
(4,40);
--使用MATERIALIZED VIEW进行加工
DROP MATERIALIZED VIEW IF EXISTS mv_table;
CREATE MATERIALIZED VIEW mv_table (i, j) AS
SELECT    *
FROM      mv_base_a;
--刷新MATERIALIZED VIEW
REFRESH   MATERIALIZED VIEW mv_table;
--查询数据
SELECT    *    FROM      mv_table;
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

2. \<column\_list>：
   * 可以指定列的名称或者向物化视图的列添加注释信息，可以指定列的名称无法指定列的类型，类型由 `AS <query>`中的SELECT结果推断而来，如果您希望指定类型可以在SELECT结果中显示CAST转化
   * 如果表中有任何列是基于表达式，建议为每列提供名称。或者as \<query>中使用别名
   ```SQL
     --指定列的comment，当有表达式时建议指定列名字
     CREATE MATERIALIZED VIEW mv
     (i,j_dd comment 'test')
     AS select i,j+1 from mv_base_a;
     +-------------+-----------+---------+
     | column_name | data_type | comment |
     +-------------+-----------+---------+
     | i           | int       |         |
     | j_dd        | int       | test    |
     +-------------+-----------+---------+
     --当存在列运算表达式使用别名方式
     CREATE  MATERIALIZED VIEW mv
     AS select i,j+1 as j_add from mv_base_a;
     +-------------+-----------+---------+
     | column_name | data_type | comment |
     +-------------+-----------+---------+
     | i           | int       |         |
     | j_add       | int       |         |
     +-------------+-----------+---------+
   ```

3. partitioned by (\<col> ):指定分区，将\<column\_list>的列作为分区，分区是一种通过在写入时将相似的行分组在一起来加快查询速度的方法。使用分区可以达到数据裁剪，优化查询。

   ```SQL
      CREATE MATERIALIZED VIEW mv
      (i,j_dd comment 'test')
      partitioned by(j_dd)
      AS select i,j+1 from mv_base_a;
   ```

4.CLUSTERED BY：可选，指定Hash Key。Lakehouse将对指定列进行Hash运算，将数据根据Hash值分散到各个数据分桶中。为了避免数据倾斜和热点，并提高并行执行效果，建议选择取值范围大、重复键值少的列作为Hash Key。通常在进行join操作时会有明显效果。建议在数据量大的场景下使用CLUSTERED BY，一般按照一个桶的大小在128MB到1GB之间。如果没有指定分桶，默认为256个buckets。

* SORTED BY：可选，指定Bucket内字段的排序方式。建议SORTED BY和CLUSTERED BY保持一致，以获得更好的性能。当指定SORTED BY子句后，行数据将按照指定的列进行排序。
  ```SQL
  --创建分桶表
  CREATE MATERIALIZED VIEW mv (i, j_dd COMMENT 'test') 
  CLUSTERED BY (j_dd) INTO 16 BUCKETS AS
  SELECT    i,
            j + 1
  FROM      mv_base_a;
  --创建分桶并指定排序
  CREATE MATERIALIZED VIEW mv
  (i, j_dd COMMENT 'test')
  CLUSTERED BY (j_dd) SORTED BY (j_dd)  INTO 16 BUCKETS  
  AS
  SELECT    i,
            j + 1
  FROM      mv_base_a;
  ```

5. COMMENT:指定物化视图的注释信息

6. BUILD DEFERRED:这是一种物化视图的创建方式。与立即生成数据的`BUILD IMMEDIATE`不同，`BUILD DEFERRED`允许在创建物化视图时不立即生成数据。默认值是BUILD IMMEDIATE，当使用CREATE OR REPLACE语法时必须是BUILD DEFERRED

7. refreshOption可选，刷新选项
   * START WITH timestamp\_exp 指定开始时间，支持指定一个时间戳表达式，如果不写 START WITH 则从当前时间开始刷新
     * `timestamp_expression`返回结果是一个标准的时间戳类型的表达式，TIMESTAMP AS OF指定的最早时间戳取决[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。如果未指定则使用当前时间戳的版本数据，例如：
       \* `'2023-11-07 14:49:18'`，即可以强制转换为时间戳的字符串。
       \* `cast('2023-11-07 14:49:18 Asia/Shanghai' as timestamp)`。
       \* `current_timestamp() - interval '12' hours`。
       \* 本身就是时间戳或可强制转换为时间戳的任何其他表达式。
     ```
     --指定第二天开始刷新,刷新时间间隔20个小时
     CREATE MATERIALIZED VIEW mydt
          (i,j)
          REFRESH
          START WITH current_timestamp() +INTERVAL '1' DAY
          INTERVAL '20' HOUR
         vcluster test_alter AS
         SELECT    *
         FROM      mv_base_a;
     ```
   * interval\_time指定时间间隔，支持[时间间隔类型interval](INTERVAL.md)，如果不写interval\_time，写了 START WITH 则只定时刷新一次START WITH 指定的时间。interval\_time时间间隔如下

| 语法                                  | 描述                           | 示例                                                        |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------- |
| INTERVAL '\[+ \| -]' DAY            | 仅指定DAY间隔                     | INTERVAL '1' DAY表示1天                                      |
| INTERVAL '\[+ \| -]' HOUR           | 仅指定HOUR间隔                    | INTERVAL '23' HOUR表示23小时                                  |
| INTERVAL '\[+ \| -]' MINUTE         | 仅指定MINUTE间隔                  | INTERVAL '59' MINUTE表示59分钟                                |
| INTERVAL '\[+ \| -]' SECOND         | 仅指定SECOND间隔                  | INTERVAL '59.999' SECOND表示59.999秒                         |
| INTERVAL '\[+ \| -] ' DAY TO HOUR   | 同时指定DAY和HOUR间隔               | INTERVAL '1 23' DAY TO HOUR表示1天23小时                       |
| INTERVAL '\[+ \| -] ' DAY TO MINUTE | 同时指定DAY、HOUR和MINUTE间隔        | INTERVAL '1 23:59' DAY TO MINUTE表示1天23小时59分钟              |
| INTERVAL '\[+ \| -] ' DAY TO SECOND | 同时指定DAY、HOUR、MINUTE和SECOND间隔 | INTERVAL '1 23:59:59.999' DAY TO SECOND表示1天23小时59分59.999秒 |

day：取值范围为\[0, 2147483647]。 hour：取值范围为\[0, 23]。minute：取值范围为\[0, 59]。second：取值范围为\[0, 59.999999999]。

* INTERVAL最小值是1分钟，可以用 60 SECOND 或者1 MINUTE 来表示
  * INTERVAL支持带引号或者不带引号，以下表示是等价的：
    \*  INTERVAL "60 SECOND"
    \*  INTERVAL ‘60 SECOND’
    \* INTERVAL 60 SECOND
  * INTERVAL支持的单位：SECOND，MINUTE，HOUR，DAY
  * INTERVAL单位不区分大小写，HOUR、hour是等价的

* 在 `refreshOption` 中指定计算集群。自动刷新会消耗资源，因此需要明确指定计算集群。如果未指定，将默认使用当前会话的计算集群。您可以通过 `SELECT current_vcluster()` 查看当前会话的计算集群。

  ```SQL
  CREATE MATERIALIZED VIEW my_mv (i, j)
  REFRESH   interval '1' MINUTE vcluster test AS
  SELECT    *
  FROM      mv_base_a;
  ```

8. DISABLE QUERY REWRITE：这是指物化视图不支持查询重写的特性。查询重写是指数据库优化器在对物化视图的基表进行查询时，自动判断是否可以通过查询物化视图来得到结果，如果可以，则避免了聚集或连接操作，直接从已经计算好的物化视图中读取数据。

## 注意事项

* 物化视图的增量刷新是基于基表的历史版本。历史版本取决于[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。此参数定义了在被删除数据被保留的时间长度，Lakehouse默认保留数据一天。根据您的业务需求，您可以通过调整 `data_retention_days` 参数来延长或缩短数据的保留周期。请注意，调整数据保留周期可能会影响存储成本。延长保留周期会增加存储需求，从而可能增加相关的费用。

## 示例

### 示例1 简单物化视图

本示例展示了如何创建一个表 (`inventory`)，以及如何基于该表创建一个物化视图 (`mv_inventory_basic`)。接着，插入了一条数据，然后从物化视图中选择数据、刷新物化视图，最后再次从物化视图中选择数据，从而观察手工刷新物化视图的效果。

```SQL
-- 创建一个名为 inventory 的表，包括 product_ID、wholesale_price 和 description 字段
CREATE TABLE inventory (product_ID INTEGER, wholesale_price FLOAT, description VARCHAR);

-- 如果物化视图 mv_inventory_basic 不存在，则创建该视图，选择 inventory 表中的 product_ID、wholesale_price 和 description 字段
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_inventory_basic AS
SELECT product_ID, wholesale_price, description
FROM inventory;

-- 向 inventory 表中插入一条数据：
INSERT INTO inventory (product_ID, wholesale_price, description) VALUES 
    (1, 1.00, 'cog');

-- 从物化视图 mv_inventory_basic 中选择 product_ID 和 wholesale_price 字段，查看插入数据后的视图内容
SELECT product_ID, wholesale_price FROM mv_inventory_basic;

-- 刷新物化视图 mv_inventory_basic，以确保视图内容与基表保持一致
REFRESH MATERIALIZED VIEW mv_inventory_basic;

-- 再次从物化视图 mv_inventory_basic 中选择 product_ID 和 wholesale_price 字段，查看刷新后的视图内容
SELECT product_ID, wholesale_price FROM mv_inventory_basic;
```

以上 SQL 语句展示了如何创建和使用物化视图。在实际操作中，物化视图可以显著提高查询性能，尤其是在涉及复杂计算或大量数据时。通过刷新物化视图，确保视图数据与源表数据保持一致，以提供最新的查询结果。**注意：由于在创建物化视图时没有使用调度参数因此这里是进行手动刷新**。

### 示例2 带列列表和注释的物化视图

```SQL
CREATE MATERIALIZED VIEW mv_inventory_with_comment
(product_ID, wholesale_price, description)
COMMENT 'This is a materialized view for inventory'
AS
SELECT product_ID, wholesale_price, description
FROM inventory;
```

### 示例3 带分区和聚簇的物化视图

```SQL
CREATE MATERIALIZED VIEW mv_inventory_partitioned_clustered

(product_ID, wholesale_price, description)

PARTITIONED BY (product_ID)

CLUSTERED BY (product_ID)

AS

SELECT product_ID, wholesale_price, description

FROM inventory;
```

### 示例4 带刷新选项和虚拟计算集群的物化视图

```SQL
CREATE MATERIALIZED VIEW mv_inventory_refresh

REFRESH START WITH current_timestamp INTERVAL '1 HOUR' VCLUSTER default

AS

SELECT product_ID, wholesale_price, description

FROM inventory;
```

修改带有刷新选项的物化视图的刷新周期：

```SQL
CREATE OR REPLACE MATERIALIZED VIEW mv_inventory_refresh

BUILD DEFERRED

REFRESH START WITH current_timestamp INTERVAL '1 MINUTE' VCLUSTER default

DISABLE QUERY REWRITE

AS

SELECT product_ID, wholesale_price, description

FROM inventory;
```

查看修改结果：

```SQL
DESC EXTENDED mv_inventory_refresh;
```

可以看到refresh\_interval\_second的值已经是60了，表名修改刷新周期成功。
对于按周期自动刷新的物化视图，如果需要暂停或者恢复自动刷新，请参考：
[修改物化视图](alter-materialzied-view.md)

### 示例5 综合示例

```SQL
CREATE MATERIALIZED VIEW mv_inventory_full
(product_ID, wholesale_price, description)
COMMENT 'Materialized view with partition, clustering, and refresh options'
PARTITIONED BY (product_ID)
CLUSTERED BY (wholesale_price)
REFRESH START WITH current_timestamp INTERVAL '1 day' VCLUSTER 'default_ap'
AS
SELECT product_ID, wholesale_price, description
FROM inventory;

```

### 示例6：创建物化视图并添加注释

重建MATERIALIZED VIEW可以复用上次结果。场景包含加列，可以重用上次的mv，添加的新的列老数据显示为null

**案例**

```SQL
CREATE    TABLE employees (
          emp_id int,
          emp_name varchar,
          dept_id int,
          salary int
          );

-- 创建一个测试表，存储部门的信息
CREATE    TABLE departments (
          dept_id int,
          dept_name varchar,
          LOCATION varchar
          );

-- 插入一些数据到 employees 表
INSERT    INTO employees
VALUES    (1001, '张三', 10, 5000),
          (1002, '李四', 20, 6000),
          (1003, '王五', 10, 7000),
          (1004, '赵六', 30, 8000),
          (1005, '孙七', 40, 9000);

-- 插入一些数据到 departments 表
INSERT    INTO departments
VALUES    (10, '销售部', '北京'),
          (20, '研发部', '上海'),
          (30, '财务部', '广州'),
          (40, '人事部', '深圳');

-- 创建一个物化视图，存储每个部门的员工数量和平均工资
CREATE materialized VIEW dept_emp_stats AS
SELECT    d.dept_id,
          d.dept_name,
          d.location,
          count(e.emp_id) AS emp_count,
          avg(e.salary) AS avg_salary
FROM      departments d
JOIN      employees e ON d.dept_id = e.dept_id
GROUP BY  d.dept_id,
          d.dept_name,
          d.location;

SELECT    *
FROM      departments;

--给departments加上一列
ALTER     TABLE departments ADD COLUMN col1 string;

INSERT    INTO employees
VALUES    (1001, 'aa', 10, 5000);

--使用create or replace语法加列。加列为了避免重算会重用上次结果，可以看到直接在job profile使用的上次mv的表
CREATE OR       
REPLACE materialized VIEW dept_emp_stats build deferred disable QUERY rewrite AS
SELECT    d.dept_id,
          d.dept_name,
          d.location,
          any_value (d.col1) col1,
          count(e.emp_id) AS emp_count,
          avg(e.salary) AS avg_salary
FROM      departments d
JOIN      employees e ON d.dept_id = e.dept_id
GROUP BY  d.dept_id,
          d.dept_name,
          d.location;

--查询结果含有上次结果
SELECT    *
FROM      dept_emp_stats;
```



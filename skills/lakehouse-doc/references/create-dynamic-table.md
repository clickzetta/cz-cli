# 创建动态表（Dynamic Table）

## 功能

动态表（Dynamic Table）是一种特殊的表，它可以实时地根据查询语句来更新数据。动态表可以让您更加灵活地处理数据，提高查询效率。更多使用方式参考[动态表介绍](dynamic-table-introduce.md)和[增量计算部分](dynamic-table.md)

## 普通动态表创建语法

```SQL

CREATE [ OR REPLACE | IF NOT EXISTS ] DYNAMIC TABLE dtname
[ (column_list ) ]
[PARTITIONED BY (column_name) ]
[CLUSTERED BY (column_name)]
[COMMENT view_comment]
[PROPERTIES('data_lifecycle'='day_num')];
[refreshOption]
AS <query>;  

refreshOption ::=
    REFRESH 
    [START WITH timestamp_expr]  [interval_time] VCLUSTER vcname
```

**必需参数**

1. dtname: 指定动态表名称。
2. AS query：动态表所包含的查询语句。

**可选参数**

1. IF NOT EXISTS:可选，如果指定的物化视图名字存在，系统不会报错，但是物化视图不会创建成功。不能和OR REPLACE同时使用

2. OR REPLACE:在传统数据库中，此选项用于在同一个事务内用新对象替换旧对象，并删除旧对象的数据。但在Lakehouse中，为了支持动态表（Dynamic Table）的增加、删除和修改操作，我们保留了数据以及元数据权限信息。这意味着，即使在修改表结构或SQL逻辑时，原有数据也不会丢失。此功能特别适用于添加或删除列、调整SQL处理逻辑以及变更数据类型。需要注意的是如果用户不是简单的 删除列 / 添加列
   添加列定义：只能是从表一路经由SELECT透传的，不能参与任何会影响其他列的计算例如 join key, group key 等。则在 Create Or Replace 发生后，REFRESH任务会退化为一次全量刷新

   ```
   --修改调度周期
   --原表
   CREATE DYNAMIC TABLE dt_name
   REFRESH   interval 10 MINUTE vcluster DEFAULT AS
   SELECT    *
   FROM      student02;

   --修该后
   CREATE OR  REPLACE DYNAMIC TABLE dt_name
   REFRESH   interval 20 MINUTE vcluster DEFAULT AS
   SELECT    *
   FROM      student02;

   --修改计算集群
   --原表
   CREATE DYNAMIC TABLE dt_name
   REFRESH   interval 10 MINUTE vcluster DEFAULT AS
   SELECT    *
   FROM      student02;

   --修该后
   CREATE OR  REPLACE DYNAMIC TABLE dt_name
   REFRESH   interval 10 MINUTE vcluster alter_vc AS
   SELECT    *
   FROM      student02;

   --增加列
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

    --减列
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
   CREATE OR  REPLACE DYNAMIC TABLE change_table (i, j) AS
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

   --修改SQL语法定义
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
   CREATE OR REPLACE DYNAMIC TABLE change_table (i, j) AS
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

3. \<column\_list>：
   * 可以指定列的名称或者向dynamic table的列添加注释信息，可以指定列的名称无法指定列的类型，类型由 `AS <query>`中的SELECT结果推断而来，如果您希望指定类型可以在SELECT结果中显示CAST转化
   * 如果表中有任何列是基于表达式，建议为每列提供名称。或者as \<query>中使用别名
   ```SQL
     --指定列的comment，当有表达式时建议指定列名字
   CREATE DYNAMIC TABLE change_table_dy (i, j_dd COMMENT 'test') AS
   SELECT    i,
             j + 1
   FROM      dy_base_a;
     +-------------+-----------+---------+
     | column_name | data_type | comment |
     +-------------+-----------+---------+
     | i           | int       |         |
     | j_dd        | int       | test    |
     +-------------+-----------+---------+
     --当存在列运算表达式使用别名方式
   CREATE DYNAMIC TABLE change_table_dy AS
   SELECT    i,
             j + 1 AS j_add
   FROM      dy_base_a;
     +-------------+-----------+---------+
     | column_name | data_type | comment |
     +-------------+-----------+---------+
     | i           | int       |         |
     | j_add       | int       |         |
     +-------------+-----------+---------+
   ```

4. partitioned by (\<col> ):指定分区，将\<column\_list>的列作为分区，分区是一种通过在写入时将相似的行分组在一起来加快查询速度的方法。使用分区可以达到数据裁剪，优化查询

   ```SQL
   CREATE DYNAMIC TABLE change_table_dy (i, j_dd COMMENT 'test') PARTITIONED BY (j_dd) AS
   SELECT    i,
             j + 1
   FROM      dy_base_a;
   ```

4.CLUSTERED BY：可选，指定Hash Key。Lakehouse将对指定列进行Hash运算，将数据根据Hash值分散到各个数据分桶中。为了避免数据倾斜和热点，并提高并行执行效果，建议选择取值范围大、重复键值少的列作为Hash Key。通常在进行join操作时会有明显效果。建议在数据量大的场景下使用CLUSTERED BY，一般按照一个桶的大小在128MB到1GB之间。如果没有指定分桶，默认为256个buckets。

* SORTED BY：可选，指定Bucket内字段的排序方式。建议SORTED BY和CLUSTERED BY保持一致，以获得更好的性能。当指定SORTED BY子句后，行数据将按照指定的列进行排序。
  ```SQL
  --创建分桶表
  CREATE DYNAMIC TABLE change_table_dy (i, j_dd COMMENT 'test') 
  CLUSTERED BY (j_dd) INTO 16 BUCKETS AS
  SELECT    i,
            j + 1
  FROM      dy_base_a;
  --创建分桶并指定排序
  CREATE DYNAMIC TABLE change_table_dy
  (i, j_dd COMMENT 'test')
  CLUSTERED BY (j_dd) SORTED BY (j_dd)  INTO 16 BUCKETS  
  AS
  SELECT    i,
            j + 1
  FROM      dy_base_a;
  ```

5. comment:指定动态的注释信息

6. refreshOption可选，刷新选项
   * START WITH timestamp\_exp 指定开始时间，支持指定一个时间戳表达式，如果不写 START WITH 则从当前时间开始刷新
     * `timestamp_expression`返回结果是一个标准的时间戳类型的表达式，TIMESTAMP AS OF指定的最早时间戳取决[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。如果未指定则使用当前时间戳的版本数据，例如：
       \* `'2023-11-07 14:49:18'`，即可以强制转换为时间戳的字符串。
       \* `cast('2023-11-07 14:49:18 Asia/Shanghai' as timestamp)`。
       \* `current_timestamp() - interval '12' hours`。
       \* 本身就是时间戳或可强制转换为时间戳的任何其他表达式。
     ```
     --指定第二天开始刷新,刷新时间间隔20个小时
     CREATE DYNAMIC TABLE mydt (i, j)
     REFRESH   START
     WITH      current_timestamp() + INTERVAL '1' DAY INTERVAL '20' HOUR vcluster test_alter AS
     SELECT    *
     FROM      dy_base_a;
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

  * 建议使用GP型集群来刷新动态表。原因：动态表刷新过程中会根据内置策略自动执行小文件合并操作，而AP型集群不支持此功能。

  ```SQL
  CREATE DYNAMIC TABLE mydt (i, j)
  REFRESH   interval '1' MINUTE vcluster test AS
  SELECT    *
  FROM      dy_base_a;
  ```

### 注意事项

* 动态表的增量刷新是基于基表的历史版本。历史版本取决于[TIME TRAVEL](TIMETRAVEL.md)(data\_retention\_days)参数，如果指定的版本不存在则会报错。此参数定义了在被删除数据被保留的时间长度，Lakehouse默认保留数据一天。根据您的业务需求，您可以通过调整 `data_retention_days` 参数来延长或缩短数据的保留周期。请注意，调整数据保留周期可能会影响存储成本。延长保留周期会增加存储需求，从而可能增加相关的费用。

# Dynamic Table 支持参数化定义

Dynamic Table 支持参数化定义由两部分组成。

* 创建分区动态表时参数定义SESSION\_CONFIGS()\['dt.args.event\_day']。用于写在SQL加工逻辑中，参数通过 SESSION\_CONFIGS()\['dt.args.xx'] 进行定义,表示查询源表。SESSION\_CONFIGS()是系统内置函数`'dt.args.xx'`：DT参数的名称，必须以`dt.args.`开头，以避免与系统内部字段冲突。表达的含义和传统调度中select \* from source\_table where pt=${bizdate}。`SESSION_CONFIGS()['dt.args.pt']`等价于`pt=${bizdate}`，SESSION\_CONFIGS()\['dt.args.xx'] 返回值类型为 String如果需要其它类型的参数，需要加一个CAST，例如 cast(SESSION\_CONFIGS()\['dt.args.xx'] as int)。如下案例：

```sql
--源表
CREATE    TABLE source_table (col1 string, col2 string, pt string) PARTITIONED BY (pt);

--定义动态表
CREATE dynamic TABLE incremental_dt (col1, col2, pt) PARTITIONED BY (pt) AS
SELECT    col1,
          nvl(col2, col1),
          pt
FROM      source_table
WHERE     pt = SESSION_CONFIGS () ['dt.args.pt'];
```

* 刷新时通过refresh dynamic table targe\_table partition(pt=${bizdate});指定分区值，其中pt=${bizdate}。对应于传统的insert ovewrite targe\_table partition(pt=${bizdate})

```sql
--上面中定义的动态表分区字段是pt。因此刷新时传入pt=${bizdate}。这里假定bizdate是2024-11-13。刷新时应该使用如下语法
--将2024-11-13传入到创建语句时的SESSION_CONFIGS()['dt.args.pt']中，替换为2024-11-13用于过滤source_table中的数据
SET dt.args.pt = 2024 -11 -13;
--刷新时指定pt=2024-11-13表示写入到动态表的2024-11-13分区中
REFRESH   dynamic TABLE targe_table PARTITION (pt = '2024-11-13');
```

## 全量刷新与增量刷新

### 全量刷新

全量刷新发生在以下情况：

1. **非分区表**：

   * 如果在非分区表中使用了参数 `SESSION_CONFIGS()['dt.args.event_day']`，系统会根据参数值的变化决定刷新方式。
   * 如果参数值保持不变，系统将执行**增量刷新**。
   * 如果参数值发生变化，系统将执行**全量刷新**，因为参数值的变化等同于改变了表的定义。

2. **分区表**：

   * 分区存在，但是当前刷新的参数与上一次刷新的参数不相同，则进行一次全量刷新，因为参数值的变化会导致 SQL 加工逻辑发生变化。
   * 如果分区不存在（即第一次刷新某个分区），则进行一次全量刷新

```sql
-- 创建源表
CREATE    TABLE source_table (col1 string, col2 string, pt string) PARTITIONED BY (pt);

-- 创建动态表
CREATE dynamic TABLE incremental_dt (col1, col2, pt) PARTITIONED BY (pt) AS
SELECT    col1,
          nvl(col2, col1),
          pt
FROM      source_table
WHERE     pt = SESSION_CONFIGS () ['dt.args.pt'];

-- 示例 1：首次设置参数值为 2024-11-14
SET dt.args.xxx = 1;
SET dt.args.pt =2024-11-14;

--刷新为全量刷新
REFRESH   dynamic TABLE incremental_dt PARTITION (pt = '2024-11-14');


-- 示例 2：果第一次刷新某个分区，对应的参数是一个值，如果后面相同分区对应的参数发生了改变了，则相当于dt在这个分区的定义被修改了，所以会重新刷新，如下案例
SET dt.args.xxx = 2;
SET dt.args.pt = 2024-11-14;
-- 刷新动态表，指定分区 pt=2024-11-14
-- 系统会执行全量刷新，因为参数值发生了变化
REFRESH   dynamic TABLE incremental_dt PARTITION (pt = '2024-11-14');
```

### 增量刷新

增量刷新发生在以下情况：

* 非分区表的参数值保持不变。
* 分区表的参数值保持不变，且分区条件未改变。

**示例代码**：

```SQL

-- 创建源表
CREATE    TABLE source_table (col1 string, col2 string, pt string) PARTITIONED BY (pt);

-- 定义动态表
CREATE dynamic TABLE incremental_dt (col1, col2, pt) PARTITIONED BY (pt) AS
SELECT    col1,
          nvl(col2, col1),
          pt
FROM      source_table
WHERE     pt = SESSION_CONFIGS () ['dt.args.pt'];

-- 示例 1：首次设置参数值为 2024-11-13
SET dt.args.pt = 2024 -11 -13;

-- 刷新动态表，指定分区 pt=2024-11-13，全量刷新
REFRESH   dynamic TABLE target_table PARTITION (pt = '2024-11-13');

-- 示例 2：参数值和分区值未变化，再次刷新
SET dt.args.pt = 2024 -11 -13;

-- 刷新动态表，指定分区 pt=2024-11-13
-- 系统会继续执行增量刷新
REFRESH   dynamic TABLE target_table PARTITION (pt = '2024-11-13');
```

## 刷新语句

参数化定义的Dynamic Table的刷新行为取决于表是否为分区表。

### **非分区表刷新语法**：

```SQL
REFRESH DYNAMIC TABLE dt;。
```

* 非分区表的参数值保持不变，会增量刷新。非分区表的参数值发生变化，会全量刷新

### **分区表刷新语法**：

```SQL
REFRESH DYNAMIC TABLE dt PARTITION partition_spec;
```

语句刷新分区表时，必须按照表的分区层级顺序指定`partition_spec`。这意味着，如果表按照多个字段进行分区，这些字段需要按照从最高级别到最低级别的顺序被指定。

* 多级分区，partition\_spec 需要根据分区的层级依次指定。例如，如果表有三级分区(day, hour, min)，必须从高到低依次指定，不能跳过某个分区。指定 day hour 是合法的，低级分区可以忽略，不用全声明。指定 day min 是不合法的，因为它跳过了 hour

  * ```SQL
    --不合法的
    set dt.args.day = 1;
    set dt.args.min = 1;
    REFRESH   dynamic TABLE incremental_dt PARTITION (DAY = 1, MIN = 1);

    --合法的
    set dt.args.day = 1;
     set dt.args.hour = 1;
    REFRESH   dynamic TABLE incremental_dt PARTITION (DAY = 1, HOUR = 1);
    ```

**示例说明**：

假设一个表按照`day`、`hour`和`min`三级进行分区，正确的`partition_spec`指定方式如下：

* **合法指定**：您可以指定高层级和部分低层级分区，但不可跳过任何中间层级分区。

```SQL
set dt.args.day=2024-11-13;
set dt.args.hour=23;
REFRESH DYNAMIC TABLE dt PARTITION (day='2024-11-13', hour=23); 
```

在这个例子中，`day`和`hour`被指定，而`min`分区可以被忽略。

* **不合法指定**：跳过任何中间层级分区的指定是不被允许的。

```SQL
set dt.args.day=2024-11-13
set dt.args.hour=30
REFRESH DYNAMIC TABLE dt PARTITION (day='2024-11-13', min=30); 
```

## **注意事项**

* **参数与分区一致性**：在执行Dynamic Table的刷新操作时，必须确保证SQL计算的分区值与指定刷新的分区值保持一致。如果存在不一致，系统将在执行过程中报错。

```SQL
CREATE dynamic TABLE incremental_dt (col1, col2, pt) PARTITIONED BY (pt) AS
SELECT    col1,
          nvl(col2, col1),
          pt
FROM      source_table
WHERE     pt = SESSION_CONFIGS () ['dt.args.pt'];

--比如select col1, nvl(col2, col1), pt from source_table where pt = SESSION_CONFIGS()['dt.args.pt'];过滤出来对应的分区字段结果是9.系统将在执行过程中报错，
set dt.args.event_day = 9;

REFRESH   dynamic TABLE event_gettime_pt PARTITION (event_day = 19);

```

* **并发刷新任务**：在这些命令中，参数值与分区值匹配，因此可以并发执行而不会发生冲突。只要分区之间不存在冲突，系统允许同时执行多个分区的刷新任务。

```SQL
-- 为分区 event_day=19 设置参数并刷新
set dt.args.event_day = 19;

REFRESH   dynamic TABLE event_gettime_pt PARTITION (event_day = 19);

-- 为分区 event_day=20 设置参数并刷新
set dt.args.event_day = 20;

REFRESH   dynamic TABLE event_gettime_pt PARTITION (event_day = 20);
```

## 使用案例

* 动态表分区字段和源表中字段一致

```sql
CREATE TABLE event_tb_pt (
    event STRING,
    process DOUBLE,
    event_time TIMESTAMP
  );
INSERT INTO event_tb_pt VALUES
  ('event-0', 20.0, TIMESTAMP '2024-09-20 14:43:13'),
  ('event-0', 20.0, TIMESTAMP '2024-09-19 11:40:13'),
 ('event-1', 20.0, TIMESTAMP '2024-09-19 11:40:13');
--创建动态表
CREATE dynamic table  event_gettime_pt 
partitioned by(event)
AS SELECT
  event,
  process,
  YEAR(event_time) event_year,
  MONTH(event_time) event_month,
  DAY(event_time) event_day
FROM event_tb_pt
where event=SESSION_CONFIGS()['dt.args.event'];
--刷新动态表
set dt.args.event = event-0;
REFRESH   dynamic TABLE event_gettime_pt PARTITION (event = 'event-0');
SELECT *FROM event_gettime_pt;
```

* 动态表分区字段和源表中字段名字不一致。过滤条件需要根据event过滤，动态表分区字段是event\_year

```sql
DROP      TABLE IF EXISTS event_tb_pt;
CREATE TABLE event_tb_pt (
    event STRING,
    process DOUBLE,
    event_time TIMESTAMP
  );
INSERT INTO event_tb_pt VALUES
  ('event-0', 20.0, TIMESTAMP '2024-09-20 14:43:13'),
  ('event-0', 20.0, TIMESTAMP '2024-09-19 11:40:13'),
 ('event-1', 20.0, TIMESTAMP '2024-09-19 11:40:13');
--创建动态表
DROP dynamic TABLE IF EXISTS event_gettime_pt;
CREATE dynamic table  event_gettime_pt 
partitioned by(event_year)
AS SELECT
  event,
  process,
  YEAR(event_time) event_year,
  MONTH(event_time) event_month,
  DAY(event_time) event_day
FROM event_tb_pt
where event=SESSION_CONFIGS()['dt.args.event'];
--刷新动态表
set dt.args.event = event-0;
REFRESH   dynamic TABLE event_gettime_pt PARTITION (event_year = 2024);
SELECT * FROM  event_gettime_pt;
```

* 多级分区刷新

```sql
DROP      TABLE IF EXISTS event_tb_pt;
CREATE TABLE event_tb_pt (
    event STRING,
    process DOUBLE,
    event_time TIMESTAMP
  );
INSERT INTO event_tb_pt VALUES
  ('event-0', 20.0, TIMESTAMP '2024-09-20 14:43:13'),
  ('event-0', 20.0, TIMESTAMP '2024-09-19 11:40:13'),
 ('event-1', 20.0, TIMESTAMP '2024-09-19 11:40:13');
--创建动态表
DROP dynamic TABLE IF EXISTS event_gettime_pt;
CREATE dynamic table  event_gettime_pt 
partitioned by(event_year,event_month,event_day)
AS SELECT
  event,
  process,
  YEAR(event_time) event_year,
  MONTH(event_time) event_month,
  DAY(event_time) event_day
FROM event_tb_pt
where event=SESSION_CONFIGS()['dt.args.event'];
--多级分区刷新，指定高层级分区
set dt.args.event = event-0;
REFRESH   dynamic TABLE event_gettime_pt PARTITION (event_year = 2024,event_month =9);
```

### 场景案例

**案例一：将离线任务转换为增量任务**
本节将指导用户如何将原有的离线任务转换为增量任务，以实现更高效的数据处理。以下是一个基于“传统数据库”的具体操作步骤，适用于业务逻辑按天对齐和按天调度刷新的场景。

* 步骤 1：参数化原始 SQL。原始 SQL如下

  ```sql
  WITH      tmp_channel AS (
            SELECT    channel_code,
                      channel_name,
                      channel_type,
                      channel_uid
            FROM      dim.dim_shop_sales_channel_main
            WHERE     pt = '${bizdate}'
            ),
            tmp_bac_misc AS (
            SELECT    mini_number,
                      bac_no
            FROM      dim.dim_customer_bac_misc_df
            WHERE     pt = '${bizdate}'
            ),
            tmp_fxiaoke AS (
            SELECT    CASE
                                WHEN record_type IN ('dealer__c') THEN nvl(bac_no, account_no)
                                ELSE account_no
                      END AS channel_code,
                      id,
                      account_no
            FROM      ods.ods_account_obj AS a
            LEFT JOIN tmp_bac_misc ON a.account_no = tmp_bac_misc.mini_number
            WHERE     pt = '${bizdate}' AND      
                      account_no IS NOT NULL
                      --  and is_deleted = 0
                      --  and life_status not in ('invalid', 'ineffective')
            )
  INSERT    OVERWRITE TABLE dim.dim_shop_sales_channel_misc PARTITION (pt = '${bizdate}')
  SELECT    tmp_channel.channel_code,
            channel_name,
            channel_type,
            channel_uid,
            id AS fxiaoke_id,
            account_no AS fxiaoke_account_no
  FROM      tmp_channel
  LEFT JOIN tmp_fxiaoke ON tmp_channel.channel_code = tmp_fxiaoke.channel_code;
  ```

  首先，需要将原始 SQL 中的所有由调度引擎传入的参数 `${bizdate}` 替换为 `SESSION_CONFIGS()['dt.args.bizdate']`。这一步骤将使得参数值可以通过配置动态传入，而不是硬编码在 SQL 中。

  **原始 SQL 参数替换**:
  将所有 `${bizdate}` 替换为 `SESSION_CONFIGS()['dt.args.bizdate']`：

  ```sql
  CREATE dynamic TABLE im.dim_shop_sales_channel_misc
  PARTITIONED BY (pt)
  WITH      tmp_channel AS (
            SELECT    channel_code,
                      channel_name,
                      channel_type,
                      channel_uidfrom dim.dim_shop_sales_channel_main
            WHERE     pt = SESSION_CONFIGS () ['dt.args.bizdate']
            ),
            tmp_bac_misc AS (
            SELECT    mini_number,
                      bac_nofrom dim.dim_customer_bac_misc_df
            WHERE     pt = SESSION_CONFIGS () ['dt.args.bizdate']
            ), 
           tmp_fxiaoke AS (    
            SELECT    CASE
                                WHEN record_type IN ('dealer__c') THEN nvl(bac_no, account_no)
                                ELSE account_no
                      END AS channel_code,
                      id,
                      account_no
            FROM      ods.ods_account_obj AS a
            LEFT JOIN tmp_bac_misc ON a.account_no = tmp_bac_misc.mini_number
      WHERE pt = SESSION_CONFIGS()['dt.args.bizdate'] and account_no is not null
  )
  SELECT    tmp_channel.channel_code,
            channel_name,
            channel_type,
            channel_uid,
            id AS fxiaoke_id,
            account_no AS fxiaoke_account_no,
            pt
  FROM      tmp_channel
  LEFT JOIN tmp_fxiaoke ON tmp_channel.channel_code = tmp_fxiaoke.channel_code
  ;
  ```

* 步骤 2：调度刷新命令
  在每次调度时，需要将参数 `dt.args.bizdate` 设置为具体的日期值，并执行刷新命令。

  调度刷新命令示例

  ```sql
  SET dt.args.bizdate=20241130; -- ${bizdate}由Studio每次替换为具体的值
  REFRESH DYNAMIC TABLE DT PARTITION (pt ='20241130');
  ```

**案例二：增量任务数据补数，在某些情况下，用户可能需要向已有的分区中补充数据**。

* 方法 1：向源表补充数据，用户可以直接向源表中补充数据。这些补充的数据将通过相应的 REFRESH 任务自动反映到 Dynamic Table（DT）中。

  操作步骤

  1. 直接向源表插入或更新数据。
  2. 执行 REFRESH 任务，以将更改同步到 DT 中。
* 方法 2：使用 DML 语句直接向 DT 补充数据，用户也可以使用 DML 语句直接向 DT 的特定分区中插入数据。
  操作步骤
  1. 使用 DML 语句向 DT 的特定分区插入数据。
  2. 请注意，直接修改 DT 将导致下一次该分区的全量刷新。如果用户不希望出现全量刷新的结果，应避免调度该分区的 REFRESH 任务。
     示例代码
  ```sql
  INSERT INTO DYNAMIC TABLE incremental_dt VALUES (...);
  ```

**案例三：多表join**

```

DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS products;

--用户表 (users)
CREATE TABLE users (
    user_id BIGINT ,
    user_name VARCHAR(100),
    email VARCHAR(200),
    city VARCHAR(50),
    age INT,
    register_date DATE
) COMMENT '用户基础信息表';
--订单表 (orders)
CREATE TABLE orders (
    order_id BIGINT ,
    user_id BIGINT,
    product_id BIGINT,
    order_amount DECIMAL(12,2),
    order_status VARCHAR(20) ,
    order_time TIMESTAMP 
) COMMENT '用户订单表';
--商品表 (products)
CREATE TABLE products (
    product_id BIGINT,
    product_name VARCHAR(200),
    category VARCHAR(50),
    brand VARCHAR(100),
    price DECIMAL(10,2)
) COMMENT '商品信息表';
--测试数据插入
INSERT INTO users (user_id, user_name, email, city, age, register_date) VALUES
(1001, '张三', 'zhangsan@email.com', '北京', 28, date'2023-01-15'),
(1002, '李四', 'lisi@email.com', '上海', 32, date'2023-02-20'),
(1003, '王五', 'wangwu@email.com', '深圳', 25, date'2023-03-10'),
(1004, '赵六', 'zhaoliu@email.com', '广州', 35, date'2023-01-25'),
(1005, '钱七', 'qianqi@email.com', '杭州', 29, date'2023-04-05'),
(1006, '孙八', 'sunba@email.com', '北京', 31, date'2023-02-15'),
(1007, '周九', 'zhoujiu@email.com', '上海', 27, date'2023-03-20'),
(1008, '吴十', 'wushi@email.com', '深圳', 33, date'2023-01-30'),
(1009, '郑一', 'zhengyi@email.com', '成都', 26, date'2023-04-10'),
(1010, '王二', 'wanger@email.com', '西安', 30, date'2023-02-25');
INSERT INTO products (product_id, product_name, category, brand, price) VALUES
(2001, 'iPhone 15 Pro', '电子产品', '苹果', 8999.00),
(2002, '华为 Mate 60', '电子产品', '华为', 6999.00),
(2003, '小米13 Ultra', '电子产品', '小米', 5999.00),
(2004, 'MacBook Pro', '电子产品', '苹果', 16999.00),
(2005, '联想ThinkPad', '电子产品', '联想', 8999.00),
(2006, '耐克运动鞋', '服装鞋帽', '耐克', 899.00),
(2007, '阿迪达斯外套', '服装鞋帽', '阿迪达斯', 699.00),
(2008, '优衣库T恤', '服装鞋帽', '优衣库', 199.00),
(2009, '海蓝之谜面霜', '美妆护肤', '海蓝之谜', 2280.00),
(2010, '兰蔻口红', '美妆护肤', '兰蔻', 320.00),
(2011, '雅诗兰黛精华', '美妆护肤', '雅诗兰黛', 1580.00),
(2012, '星巴克咖啡豆', '食品饮料', '星巴克', 128.00),
(2013, '茅台酒', '食品饮料', '茅台', 2699.00),
(2014, '哈根达斯冰淇淋', '食品饮料', '哈根达斯', 68.00),
(2015, '戴森吹风机', '家用电器', '戴森', 2990.00);
INSERT INTO orders (order_id, user_id, product_id, order_amount, order_status, order_time) VALUES
-- 张三的订单
(3001, 1001, 2001, 8999.00, 'completed', timestamp'2024-01-10 10:30:00'),
(3002, 1001, 2006, 899.00, 'completed', timestamp'2024-01-15 14:20:00'),
(3003, 1001, 2012, 128.00, 'completed', timestamp'2024-02-01 09:15:00'),
(3004, 1001, 2009, 2280.00, 'pending', timestamp'2024-02-10 16:45:00'),

-- 李四的订单
(3005, 1002, 2004, 16999.00, 'completed', timestamp'2024-01-20 11:00:00'),
(3006, 1002, 2015, 2990.00, 'completed', timestamp'2024-01-25 15:30:00'),
(3007, 1002, 2013, 2699.00, 'completed', timestamp'2024-02-05 18:20:00'),

-- 王五的订单
(3008, 1003, 2002, 6999.00, 'completed', timestamp'2024-01-12 13:45:00'),
(3009, 1003, 2007, 699.00, 'completed', timestamp'2024-01-18 10:15:00'),
(3010, 1003, 2010, 320.00, 'completed', timestamp'2024-02-02 14:30:00'),
(3011, 1003, 2008, 199.00, 'completed',timestamp'2024-02-08 16:00:00'),
(3012, 1003, 2014, 68.00, 'completed', timestamp'2024-02-12 12:20:00'),

-- 赵六的订单
(3013, 1004, 2003, 5999.00, 'completed', timestamp'2024-01-08 09:30:00'),
(3014, 1004, 2011, 1580.00, 'completed', timestamp'2024-01-22 17:15:00'),

-- 钱七的订单
(3015, 1005, 2005, 8999.00, 'completed', timestamp'2024-01-30 11:45:00'),
(3016, 1005, 2006, 899.00, 'completed', timestamp'2024-02-06 13:20:00'),
(3017, 1005, 2012, 128.00, 'completed', timestamp'2024-02-14 15:10:00'),

-- 孙八的订单
(3018, 1006, 2001, 8999.00, 'completed', timestamp'2024-01-14 10:00:00'),
(3019, 1006, 2009, 2280.00, 'completed', timestamp'2024-01-28 14:45:00'),
(3020, 1006, 2013, 2699.00, 'completed', timestamp'2024-02-03 16:30:00'),
(3021, 1006, 2015, 2990.00, 'cancelled', timestamp'2024-02-09 12:15:00'),

-- 周九的订单
(3022, 1007, 2007, 699.00, 'completed', timestamp'2024-01-16 11:20:00'),
(3023, 1007, 2008, 199.00, 'completed', timestamp'2024-01-26 13:40:00'),
(3024, 1007, 2010, 320.00, 'completed', timestamp'2024-02-07 15:25:00'),

-- 吴十的订单
(3025, 1008, 2002, 6999.00, 'completed', timestamp'2024-01-11 09:50:00'),
(3026, 1008, 2004, 16999.00, 'completed', timestamp'2024-02-15 17:00:00'),

-- 郑一的订单
(3027, 1009, 2003, 5999.00, 'completed', timestamp'2024-01-24 12:30:00'),
(3028, 1009, 2006, 899.00, 'completed', timestamp'2024-02-04 14:15:00'),
(3029, 1009, 2014, 68.00, 'completed', timestamp'2024-02-11 10:45:00'),

-- 王二的订单
(3030, 1010, 2011, 1580.00, 'completed', timestamp'2024-01-13 16:20:00'),
(3031, 1010, 2012, 128.00, 'completed', timestamp'2024-01-29 11:35:00'),
(3032, 1010, 2014, 68.00, 'completed', timestamp'2024-02-13 13:50:00');




--用户购买行为分析表
CREATE DYNAMIC TABLE user_purchase_analysis (
    user_id BIGINT,
    user_name STRING,
    city STRING,
    age INT,
    total_orders BIGINT,
    total_amount DECIMAL(12,2),
    avg_order_amount DECIMAL(10,2),
    favorite_category STRING,
    last_order_time TIMESTAMP
)
COMMENT '用户购买行为实时分析表'
REFRESH  interval 5 MINUTE VCLUSTER tpch
AS 
SELECT 
    u.user_id,
    u.user_name,
    u.city,
    u.age,
    COUNT(o.order_id) as total_orders,
    SUM(o.order_amount) as total_amount,
    AVG(o.order_amount) as avg_order_amount,
    MAX(p.category) as favorite_category,
    MAX(o.order_time) as last_order_time
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id AND o.order_status = 'completed'
LEFT JOIN products p ON o.product_id = p.product_id
GROUP BY u.user_id, u.user_name, u.city, u.age;
REFRESH   DYNAMIC TABLE user_purchase_analysis;
SELECT  * FROM      user_purchase_analysis;
```

**注意事项**

* 直接向 DT 插入的数据将参与 DT 的下游计算。如果下游的老分区不需要这些数据，请不要调度涉及这些数据的分区的 REFRESH 任务。
* 其他未受影响的分区仍然可以进行增量刷新。

**案例三：在不同 VC 中执行增量任务，对于参数化声明的分区化 DT，不同分区的刷新任务可以同时执行。用户可以根据需要将不同的 REFRESH 任务分配到不同的虚拟集群（VC）中执行**。
操作步骤

1. 根据实效性要求和资源需求，将不同的 REFRESH 任务分配到不同的 VC 中。
2. 例如，对于实效性要求较高的新分区，可以将其 REFRESH 任务放在资源较多的大 VC 中执行。
3. 对于其他老分区的补充任务，可以将其 REFRESH 任务放在资源较少的小 VC 中执行。

## 参考文档

* [动态表可视化界面开发](dynamic_table_task.md)
* [查看动态表详情](desc-dynamic-table.md)
* [查看schema下所有的动态表](show-dynamic-table.md)
* [修改动态表](alter-dynamic-table.md)
* [删除动态表](drop-dynamic-table.md)
* [查看动态表刷新历史](refresh-history.md)
* [查看动态表建表语句](show-create-table.md)
* [恢复删除的动态表](UNDROP-TABLE.md)
* [恢复动态表至指定版本](restore.md)
* [查看动态表版本历史](desc-history.md)
* [查看动态表指定版本数据](TIMETRAVEL.md)
* [动态表介绍](dynamic-table-introduce.md)

^

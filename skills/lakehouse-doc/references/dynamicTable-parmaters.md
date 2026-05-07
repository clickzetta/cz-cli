# Dynamic Table 支持参数化定义

Dynamic Table 的参数化定义由两部分组成。

* 创建分区动态表时，参数通过 SESSION_CONFIGS()['dt.args.xx'] 进行定义，用于写在 SQL 加工逻辑中，表示查询源表。SESSION_CONFIGS()是系统内置函数`'dt.args.xx'`：DT参数的名称，必须以`dt.arg.`开头，以避免与系统内部字段冲突。表达的含义和传统调度中select * from source_table where pt=${bizdate}，`SESSION_CONFIGS()['dt.args.pt']`等价于`pt=${bizdate}`。SESSION_CONFIGS()['dt.args.xx'] 返回值类型为 String。如果需要其它类型的参数，需要使用 CAST 函数进行转换，例如 `cast(SESSION_CONFIGS()['dt.args.xx'] as int)`。 如下案例：

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

* 刷新时通过 `refresh dynamic table target_table partition(pt=${bizdate});` 指定分区值，其中 `pt=${bizdate}`。这对应于传统的 `insert overwrite target_table partition(pt=${bizdate})`。

```sql
--上面中定义的动态表分区字段是pt。因此刷新时传入pt=${bizdate}。这里假定bizdate是2024-11-13。刷新时应该使用如下语法
--将2024-11-13传入到创建语句时的SESSION_CONFIGS()['dt.args.pt']中，替换为2024-11-13用于过滤source_table中的数据
SET dt.args.pt = 2024-11-13;
--刷新时指定pt=2024-11-13表示写入到动态表的2024-11-13分区中
REFRESH   dynamic TABLE incremental_dt PARTITION (pt = '2024-11-13');
```



## 全量刷新与增量刷新

### 全量刷新

全量刷新发生在以下情况：

1. **非分区表**：

   - 如果在非分区表中使用了参数 `SESSION_CONFIGS()['dt.args.event_day']`，系统会根据参数值的变化决定刷新方式。
   - 如果参数值保持不变，系统将执行**增量刷新**。
   - 如果参数值发生变化，系统将执行**全量刷新**，因为参数值的变化等同于改变了表的定义。

2. **分区表**：

   * 如果分区已存在，但当前刷新的参数与上一次刷新的参数不相同，则进行一次全量刷新，因为参数值的变化会导致 SQL 加工逻辑发生变化。
   * 如果分区不存在（即第一次刷新某个分区），则进行一次全量刷新。
    

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

-- 示例 1：首次设置参数值为 2024-11-13
SET dt.args.xxx = 1;
SET dt.args.pt = 2024-11-13;
--刷新为全量刷新
REFRESH   dynamic TABLE incremental_dt PARTITION (pt = '2024-11-13');

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
SET dt.args.pt = 2024-11-13;

-- 刷新动态表，指定分区 pt=2024-11-13，全量刷新
REFRESH   dynamic TABLE target_table PARTITION (pt = '2024-11-13');

-- 示例 2：参数值和分区值未变化，再次刷新
SET dt.args.pt = 2024-11-13;

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

* 非分区表的参数值保持不变，会进行增量刷新。非分区表的参数值发生变化，会进行全量刷新。

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

* **合法指定**：可以指定高层级和部分低层级分区，但不可跳过任何中间层级分区。

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

* **参数与分区一致性**：在执行 Dynamic Table 的刷新操作时，必须确保 SQL 计算逻辑中使用的分区参数值与 REFRESH 语句中指定的分区值保持一致。如果存在不一致，系统将在执行过程中报错。

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

* 动态表分区字段和源表字段名不一致。过滤条件需要根据 `event` 字段过滤，而动态表的分区字段是 `event_year`。

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

## 场景案例

**案例一：将离线任务转换为增量任务**

本节将指导用户如何将原有的离线任务转换为增量任务，以实现更高效的数据处理。以下是一个基于“传统调度”的具体操作步骤，适用于业务逻辑按天对齐和按天调度刷新的场景。

* 步骤 1：参数化原始 SQL。原始 SQL如下

  ```sql
  with tmp_channel as (
    select
      channel_code,
      channel_name,
      channel_type,
      channel_uid
    from dim.dim_shop_sales_channel_main
    where pt = '${bizdate}'
  ), tmp_bac_misc as (
    select
      mini_number,
      bac_no
    from dim.dim_customer_bac_misc_df
    where pt = '${bizdate}'
  ), tmp_fxiaoke as (
    select
      case
        when record_type in ('dealer__c') then nvl(bac_no, account_no)
        else account_no
      end as channel_code,
      id,
      account_no
    from ods.ods_account_obj as a
    left join tmp_bac_misc on a.account_no = tmp_bac_misc.mini_number
    where pt = '${bizdate}' and account_no is not null
  --  and is_deleted = 0
  --  and life_status not in ('invalid', 'ineffective')
  )
  insert overwrite table dim.dim_shop_sales_channel_misc partition(pt='${bizdate}')
  select
    tmp_channel.channel_code,
    channel_name,
    channel_type,
    channel_uid,
    id as fxiaoke_id,
    account_no as fxiaoke_account_no
  from tmp_channel
  left join tmp_fxiaoke on tmp_channel.channel_code = tmp_fxiaoke.channel_code ;
  ```

  首先，需要将原始 SQL 中的所有由调度引擎传入的参数 `${bizdate}` 替换为 `SESSION_CONFIGS()['dt.args.bizdate']`。这一步骤将使得参数值可以通过配置动态传入，而不是硬编码在 SQL 中。

  **原始 SQL 参数替换**:
  将所有 `${bizdate}` 替换为 `SESSION_CONFIGS()['dt.args.bizdate']`：

  ```sql
  create dynamic table im.dim_shop_sales_channel_misc
  partitioned by(pt)
  with tmp_channel as (
    select
      channel_code,
      channel_name,
      channel_type,
      channel_uidfrom dim.dim_shop_sales_channel_main
      where pt = SESSION_CONFIGS()['dt.args.bizdate']
  ), tmp_bac_misc as (
    select
      mini_number,
      bac_nofrom dim.dim_customer_bac_misc_df
      where pt = SESSION_CONFIGS()['dt.args.bizdate']
  ), tmp_fxiaoke as (
    select
      case
        when record_type in ('dealer__c') then nvl(bac_no, account_no)
        else account_noend as channel_code,
      id,
      account_nofrom ods.ods_account_obj as aleft join tmp_bac_misc on a.account_no = tmp_bac_misc.mini_number
      where pt = SESSION_CONFIGS()['dt.args.bizdate'] and account_no is not null
  )
  select
    tmp_channel.channel_code,
    channel_name,
    channel_type,
    channel_uid,
    id as fxiaoke_id,
    account_no as fxiaoke_account_no,
    pt
  from tmp_channel
  left join tmp_fxiaoke on tmp_channel.channel_code = tmp_fxiaoke.channel_code
  ;
  ```

* 步骤 2：调度刷新命令
  在每次调度时，需要将参数 `dt.args.bizdate` 设置为具体的日期值，并执行刷新命令。

  调度刷新命令示例

  ```sql
  SET dt.args.bizdate=20241130; -- ${bizdate}由Studio每次替换为具体的值
  REFRESH DYNAMIC TABLE DT PARTITION (pt ='20241130');
  ```

**案例二：增量任务数据补数**

在某些情况下，用户可能需要向已有的分区中补充数据。

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

**注意事项**

* 直接向 DT 插入的数据将参与 DT 的下游计算。如果下游的老分区不需要这些数据，请不要调度涉及这些数据的分区的 REFRESH 任务。
* 其他未受影响的分区仍然可以进行增量刷新。

**案例三：在不同 VC 中执行增量任务**

对于参数化声明的分区化 DT，不同分区的刷新任务可以同时执行。用户可以根据需要将不同的 REFRESH 任务分配到不同的虚拟集群（VC）中执行。
**操作步骤**：
1. 根据时效性要求和资源需求，将不同的 REFRESH 任务分配到不同的 VC 中。
2. 例如，对于时效性要求较高的新分区，可以将其 REFRESH 任务放在资源较多的大 VC 中执行。
3. 对于其他老分区的补充任务，可以将其 REFRESH 任务放在资源较少的小 VC 中执行。



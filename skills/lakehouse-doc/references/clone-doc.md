# CREATE ....CLONE

> 【预览发布】本功能当前处于公开预览发布阶段。

在 Lakehouse 中，克隆表操作创建了一个表的独立副本，该副本与原始表完全分离，互不影响。克隆表在创建时不占用额外的存储空间，因为它共享原始表的数据版本。但是，如果原始表数据发生变化并影响到克隆表中的数据，克隆表将需要为这些变化支付存储费用。克隆表具有与普通表相似的功能，包括查询、复制和删除等操作。Lakehouse 支持克隆普通表和动态表，并且允许创建克隆的克隆，即克隆一个已经是克隆的表。

## 克隆表注意事项

* 克隆操作不会复制原始表的权限，新克隆的表将具有独立的权限设置。
* 克隆操作不会复制用户设置的属性，包括生命周期和数据时间旅行保留周期。
* 实时写入且未提交的数据不会被克隆。因此，在克隆完成后，刚刚写入的数据将无法在克隆表中找到。
* 不支持克隆外部表。

## 普通表克隆

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name CLONE <source_object_name> [TIMESTAMP AS OF timestamp_expression]
```

* 可以使用 `TIMESTAMP AS OF timestamp_expression` 来克隆动态表在指定时间点的版本。只要该时间点在\*\*[数据保留周期](TIMETRAVEL.md)\*\*内（`data_retention_days`）。
  * `timestamp_expression` 可以是以下任意一项：
    * `'2024-10-18T22:15:12.013Z'`，即可以强制转换为时间戳的字符串
    * `cast('2024-10-18 13:36:32 ' as timestamp)`
    * `'2024-10-18'`，即日期字符串
    * `current_timestamp() - interval 12 hours`
    * `date_sub(current_date(), 1)`
    * 本身就是时间戳或可强制转换为时间戳的任何其他表达式

```
CREATE TABLE normal_table_clone_version CLONE normal_table_base TIMESTAMP AS OF '2024-10-12 19:23:52.329';
```

## 动态表克隆

```SQL
CREATE DYNAMIC TABLE dt_name
 [
    refreshOption ::=
    REFRESH [START WITH timestamp_expr] [interval_time] VCLUSTER vcname   
 ]
  CLONE <source_dynamic_table> [TIMESTAMP AS OF timestamp_expression]
```

* 克隆出的动态表默认暂停刷新，可以使用 `ALTER DYNAMIC TABLE table_name RESUME;` 来启动刷新任务。
* `DYNAMIC TABLE dt_name`: 要创建的动态表的名称，`dt_name` 是一个占位符，您需要替换为实际的表名。
* `REFRESH`：指定表的刷新选项。克隆动态表时可以指定刷新选项：
  * 如果指定了刷新选项，则使用克隆表的刷新策略。
  * 如果未指定刷新选项，则使用默认的刷新策略。
* `START WITH timestamp_expr`: 可选子句，指定表开始刷新的时间点，`timestamp_expr` 是一个时间戳表达式。
* `interval_time`: 指定刷新间隔的时间单位，这是一个 `INTERVAL` 类型，可以是以下任意一项：
  * INTERVAL 1 year
  * INTERVAL 2 month
  * INTERVAL 3 day
  * INTERVAL 4 hour
  * INTERVAL 5 minute
  * INTERVAL 30 second
* `VCLUSTER vcname`: 指定计算集群的名称，`vcname` 是计算集群的实际名称。
* `CLONE <source_dynamic_table>`: 从现有的动态表 `<source_dynamic_table>` 克隆。
* `TIMESTAMP AS OF timestamp_expression`: 克隆动态表在指定时间点的版本，`timestamp_expression` 可以是多种时间戳表达式之一。只要该时间点在[数据保留周期](TIMETRAVEL.md)内（`data_retention_days`）。
  * `timestamp_expression` 可以是以下任意一项：
    * `'2024-10-18T22:15:12.013Z'`，即可以强制转换为时间戳的字符串
    * `cast('2024-10-18 13:36:32 ' as timestamp)`
    * `'2024-10-18'`，即日期字符串
    * `current_timestamp() - interval 12 hours`
    * `date_sub(current_date(), 1)`
    * 本身就是时间戳或可强制转换为时间戳的任何其他表达式

## 权限要求

* 需要有当前 schema 下的 `CREATE TABLE` 权限来创建克隆表。
* 需要有对原始表的 `SELECT` 权限。

## 克隆表案例

### 克隆普通表

```SQL
-- 创建普通表
CREATE TABLE normal_table_base (id BIGINT, col STRING);

-- 克隆普通表
CREATE TABLE normal_table_clone CLONE normal_table_base;

-- 指定基表的版本克隆
CREATE TABLE normal_table_clone_version CLONE normal_table_base TIMESTAMP AS OF '2024-10-12 19:23:52.329';
```

### 克隆动态表

```SQL
-- 创建动态表
CREATE DYNAMIC TABLE dt_table_base
REFRESH INTERVAL 1 MINUTE
VCLUSTER DEFAULT
AS SELECT * FROM normal_table_base;

-- 克隆动态表
CREATE DYNAMIC TABLE dt_table_clone CLONE dt_table_base;

-- 克隆时指定刷新间隔和计算集群
CREATE DYNAMIC TABLE dt_table_clone_refresh
REFRESH INTERVAL 2 MINUTE
VCLUSTER DEFAULT
CLONE dt_table_base;

-- 克隆时指定动态表的版本
CREATE DYNAMIC TABLE dt_table_clone_version
CLONE dt_table_base TIMESTAMP AS OF '2024-10-12 20:25:32.247';
```

^

# Lakehouse参数控制

Lakehouse支持通过参数来控制包括数据对象以及当前连接会话的使用行为。本文将详细介绍如何通过修改Workspace、Schema和Table的属性来添加或修改参数，以及如何在JDBC客户端会话中设置会话参数。

## 数据对象参数

### SET PROPERTIES

**命令用途**

`SET PROPERTIES` 命令用于为数据对象设置属性。您可以添加新属性或更新现有属性的值，从而调整对象的行为和性能特征。

**语法格式**

```sql
-- 为表设置属性
ALTER TABLE [schema_name.]table_name SET PROPERTIES ('property_key1'='property_value1' [, 'property_key2'='property_value2' ...]);
-- 为schema设置属性
ALTER SCHEMA schema_name SET PROPERTIES ('property_key1'='property_value1' [, 'property_key2'='property_value2' ...]);
-- 为Workspace设置属性
ALTER WORKSPACE workspace_name SET PROPERTIES ('property_key1'='property_value1' [, 'property_key2'='property_value2' ...]);
```

**参数说明**

| 参数              | 说明                              |
| --------------- | ------------------------------- |
| schema\_name    | 可选参数，指定表所在的模式。若省略，系统使用当前会话的默认模式 |
| table\_name     | 要设置属性的表名                        |
| schema\_name    | 要设置属性的模式名                       |
| workspace\_name | 要设置属性的工作空间名                     |
| property\_key   | 属性键名，需用单引号括起                    |
| property\_value | 属性值，需用单引号括起                     |

**使用示例**

```sql
-- 为表设置压缩和自动刷新属性
ALTER TABLE sales_records SET PROPERTIES ('compression'='zstd', 'auto_refresh'='true');
-- 为模式设置数据保留期属性
ALTER SCHEMA reporting SET PROPERTIES ('data_retention_days'='90');
-- 为Workspace设置属性
ALTER WORKSPACE analytics_ws SET PROPERTIES ('aa'='bb');
```

### 表支持的参数

以下表格列出了系统属性及其描述和取值范围：

| 参数名称                              | 描述                                                                                                                                                                                                                       | 取值范围                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| data\_lifecycle                   | 数据生命周期                                                                                                                                                                                                                   | 大于0的正整数值，取值为-1代表未开启生命周期                                                   |
| data\_retention\_days             | 设置Time Travel保留期限，Time Travel保留期限决定了您可以访问多久以前的数据，包括使用 UNDROP、TABLE STREAM、RESTORE 访问历史数据和恢复历史数据。                                                                                                                            | 您可以为每个表设置不同的数据保留周期，以满足不同的业务需求。num 的设置范围为 0-90，Lakehouse 将单独对 Time Travel 收取存储费用。 |
| cz.storage.write.max.string.bytes | `STRING` 类型用于存储长度大于或等于 0 的字符序列，最大可支持 16MB 的文本数据。在批量或实时导入数据时，系统会对字段长度进行校验。若导入数据超出 16MB，可通过修改表属性调整字符串长度限制，例如将 `STRING` 长度设置为 32MB：`ALTER TABLE table_name SET PROPERTIES("cz.storage.write.max.string.bytes"="33554432");` | 大于0的整数                                                                    |
| cz.storage.write.max.binary.bytes | `binary` 类型用于存储长度最大可支持 16MB 的数据。在批量或实时导入数据时，系统会对字段长度进行校验。若导入数据超出 16MB，可通过修改表属性调整binary长度限制，例如将 `binary` 长度设置为 32MB：`ALTER TABLE table_name SET PROPERTIES("cz.storage.write.max.binary.bytes"="33554432");`              | 大于0的整数                                                                    |
| cz.storage.write.max.json.bytes   | `json` 类型用于存储长度大于或等于 0 的字符序列，最大可支持 16MB 的文本数据。在批量或实时导入数据时，系统会对字段长度进行校验。若导入数据超出 16MB，可通过修改表属性调整json字符串长度限制，例如将 `json` 长度设置为 32MB：`ALTER TABLE table_name SET PROPERTIES("cz.storage.write.max.json.bytes"="33554432");`   | 大于0的整数                                                                    |

### UNSET PROPERTIES

**命令用途**

`UNSET PROPERTIES` 命令用于移除数据对象上已设置的属性。它让您能够清除不再需要的自定义属性，将对象恢复到系统默认配置状态。

**语法格式**

```sql
-- 移除表的属性
ALTER TABLE [schema_name.]table_name UNSET PROPERTIES (property_key1 [, property_key2 ...]);
-- 移除模式的属性
ALTER SCHEMA schema_name UNSET PROPERTIES (property_key1 [, property_key2 ...]);
-- 移除Workspace的属性
ALTER WORKSPACE workspace_name UNSET PROPERTIES (property_key1 [, property_key2 ...]);
```

**参数说明**

| 参数              | 说明                              |
| --------------- | ------------------------------- |
| schema\_name    | 可选参数，指定表所在的模式。若省略，系统使用当前会话的默认模式 |
| table\_name     | 要移除属性的表名                        |
| schema\_name    | 要移除属性的模式名                       |
| workspace\_name | 要移除属性的工作空间名                     |
| property\_key   | 要移除的属性键名                        |

**使用示例**

```sql
-- a) 移除表的单个属性
ALTER TABLE sales_records UNSET PROPERTIES ('xxx');
-- b) 同时移除表的多个属性
ALTER TABLE customer_feedback UNSET PROPERTIES ('auto_refresh', 'xxxx');
-- c) 移除模式的属性
ALTER SCHEMA reporting_data UNSET PROPERTIES ('default_table_format');
-- d) 移除Workspace的属性
ALTER WORKSPACE data_science UNSET PROPERTIES ('xxx');
```

## SHOW PROPERTIES

**命令用途**

`SHOW PROPERTIES` 命令用于查看数据对象当前设置的所有属性。它帮助您了解对象的配置状态，便于属性管理和问题排查。

**语法格式**

```sql
-- 查看表的属性
SHOW PROPERTIES IN TABLE [schema_name.]table_name;
-- 查看模式的属性
SHOW PROPERTIES IN SCHEMA schema_name;
-- 查看Workspace的属性
SHOW PROPERTIES IN WORKSPACE workspace_name;
```

**参数说明**

| 参数              | 说明                              |
| --------------- | ------------------------------- |
| schema\_name    | 可选参数，指定表所在的模式。若省略，系统使用当前会话的默认模式 |
| table\_name     | 要查看属性的表名                        |
| schema\_name    | 要查看属性的模式名                       |
| workspace\_name | 要查看属性的工作空间名                     |

**使用示例**

```sql
-- 查看表的所有属性
SHOW PROPERTIES IN TABLE sales_data;
-- 查看特定模式中表的属性
SHOW PROPERTIES IN TABLE analytics.customer_metrics;
-- 查看模式的所有属性
SHOW PROPERTIES IN SCHEMA reporting;
-- 查看Workspace的所有属性
SHOW PROPERTIES IN WORKSPACE data_science;
```

**输出说明**

`SHOW PROPERTIES` 命令的输出结果是一个包含键值对的列表，如下所示：

```
+---------------+---------------+
| property_key  | property_value|
+---------------+---------------+
| compression   | zstd          |
| auto_refresh  | true          |
+---------------+---------------+
```

**支持的对象类型**

当前，Lakehouse 支持为以下三种主要对象类型管理属性：

1. **Workspace 属性**：作用于整个工作空间，影响其中的所有模式和表。通常包括资源限制、安全设置等全局配置。
2. **Schema 属性**：作用于特定模式，影响该模式下的所有表。常用于设置模式级别的默认行为。
3. **Table 属性**：作用于特定表，仅影响该表的行为和性能特性。这是最细粒度的属性设置。

### 执行行为说明

使用属性管理命令时，应注意以下行为特性：

1. **静默处理**：如果尝试移除不存在的属性，命令会静默成功，不会抛出错误。
2. **批量操作**：可在一个命令中设置或移除多个属性，提高操作效率。
3. **权限要求**：需要对应对象的 `ALTER` 权限才能修改其属性。
4. **Workspace 属性生效时间**：Workspace 级别的属性修改通常在约 1 分钟后生效。

### 应用场景

**环境迁移与配置管理**

在开发、测试和生产环境之间迁移数据应用时，属性管理非常重要。

```sql
-- 生产环境设置更严格的属性
ALTER TABLE customer_data SET PROPERTIES ('encryption'='true', 'backup_schedule'='daily');
-- 移除仅适用于测试环境的属性
ALTER TABLE customer_data UNSET PROPERTIES (debug_mode, test_flag);
```

**清理过时配置**

```sql
-- 查找具有过时属性的表
SHOW PROPERTIES IN TABLE legacy_system_data;
-- 移除过时的兼容性属性
ALTER TABLE legacy_system_data UNSET PROPERTIES (compatibility_mode, legacy_format);
```

**属性变更验证**

执行属性变更后，可通过以下方式验证操作是否成功：

```sql
-- 使用SHOW PROPERTIES命令直接查看
SHOW PROPERTIES IN TABLE modified_table;
-- 或使用DESC命令查看详细信息
DESC TABLE EXTENDED modified_table;
```

## 会话参数

Lakehouse支持在JDBC客户端会话中设置参数。以下是当前支持的参数列表：

| 参数名称                                          | 取值范围                          | 默认值                                                                                                                    | 描述                                                                          |
| --------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| query\_tag                                    | 字符串类型                         | 无                                                                                                                      | 用于标记查询的SQL                                                                  |
| schedule\_job\_queue\_priority                | 0-9                           | 0                                                                                                                      | 提交SQL时设置作业优先级，数值范围从0到9，数值越大，表示优先级越高                                         |
| cz.sql.group.by.having.use.alias.first        | true/false                    | false                                                                                                                  | 指定group by和having语句是否优先使用列的别名，而非从From语句里寻找列的名字。                             |
| cz.sql.double.quoted.identifiers              | true/false                    | false                                                                                                                  | 分隔符标示符                                                                      |
| cz.sql.cast.mode                              | tolerant/strict               | tolerant                                                                                                               | 类型转化采用的模式，默认tolerant                                                        |
| cz.optimizer.enable.mv.rewrite                | true/false                    | false                                                                                                                  | 提交SQL时是否开启Materialized View查询改写功能                                           |
| cz.sql.string.literal.escape.mode             | backslash                     | backslash                                                                                                              | 字符串转义字符。quote:引号，backslash:反斜线，quote\_backslash:同时支持引号和反斜线。默认时使用backslash反斜线进行转义。 |
| cz.sql.arithmetic.mode                        | tolerant                      | strict/tolerant                                                                                                        | 控制算数运算出错是不是抛异常。例如运算精度溢出，默认不抛出异常                                             |
| cz.sql.timezone                               | utc+08                        | 您可以指定[时区名称](https://data.iana.org/time-zones/tzdb-2021a/zone1970.tab)例如：America/Los\_Angeles、Europe/London、UTC或Etc/GMT | 设置sql时区                                                                     |
| cz.sql.remote.udf.lookup.policy               | schema\_only：强制要求UDF带Schema前缀 | builtin\_first：优先调用内置函数，udf\_first：优先调用UDF，schema\_only：默认策略，强制要求UDF带Schema前缀                                          | 动态切换 UDF 与内置函数的解析优先级                                                        |
| cz.sql.type.conversion                        | hive                          | 无                                                                                                                      | 用于兼容 Hive 的类型转换。由于 Lakehouse 和 Hive 的默认类型转换规则存在差异，设置此参数可使类型转换逻辑与 Hive 保持一致。 |
| cz.sql.function.from.unixtime.trim.to.second  | false/true                    | false                                                                                                                  | 控制 `FROM_UNIXTIME` 函数的精度处理。启用时，函数返回值将精度截断到秒级，与 Hive 的行为保持一致。                |
| cz.sql.time.parser.strict.mode                | false/true                    | false                                                                                                                  | 启用时间解析的严格模式。若时间格式与指定的格式模式不匹配，系统将抛出错误；禁用时则返回 `null`。                         |
| cz.sql.cast.string.to.integer.allow\.truncate | false/true                    | false                                                                                                                  | 控制字符串转整数时是否允许截断小数位。启用时，转换过程中的小数部分将被直接丢弃，与 Hive 的行为保持一致。                     |

## 会话参数使用方法

1. 在 Lakehouse Studio 编辑器中，您需要选中要执行的查询并执行它们。例如，要设置`query_tag`参数并执行一个简单的查询，请参考以下步骤：
   执行以下命令设置`query_tag`参数：

```sql
set query_tag='test';
select 1+2;
```

2. 如果在客户端或者 JDBC 运行会话参数，则会在整个会话期间生效。

```sql
set query_tag='test';
select 1+2;
```

上面的query\_tag仍然会生效

```
select 1+4;
```

**Python SDK 设置参数**
在 JDBC 中通过 SET 命令设置的 SQL hints 可以通过 `parameters` 参数传递。以下是一个修改时区示例：

```python
from clickzetta import connect
# 建立连接

conn = connect(username='',
               password='',
               service='region_id.api.clickzetta.com',
               instance='demo_instance',
               workspace='demo_workspace',
               schema='public',
               vcluster='default')
my_param = {
    'hints': {
        'cz.sql.timezone': 'UTC+00'
    }
}
cursor = conn.cursor()
cursor.execute("select current_timestamp();",my_param)

# 获取查询结果
results = cursor.fetchall()
for row in results:
        print(row)
# 关闭连接
cursor.close()
conn.close()
```

## 会话参数说明

### cz.sql.group.by.having.use.alias.first

此参数指定group by和having语句是否优先使用列的别名，而非从From语句里寻找列的名字。例如，考虑以下查询：

```sql
select count(*) from (select col1 as c1 from table1) t group by c1;
```

如果启用此参数，查询将使用别名`c1`进行分组。否则，将会报错找不到c1。

### query\_tag

设置query\_tag后，会话中的查询作业历史将自动在作业历史的query\_tag字段中添加自定义标签内容。可以通过set query\_tag命令方式设置，也可以在jdbc URL中设置query\_tag。例如：

```sql
set query_tag='aa';
select 1;
```

* 在jdbc url中添加query\_tag,这样提交的每条SQL都会带上query\_tag用来标识来源，可以在页面中进行过滤
  ```
  jdbc:clickzetta://demo_instance.cn-shanghai-alicloud.api.clickzetta.com/default?schema=public&query_tag=test
  ```
* python代码中设置query\_tag
  ```python
  # 建立连接
  conn = connect(username='',
                 password='',
                 service='cn-shanghai-alicloud.api.clickzetta.com',
                 instance='demo_instance',
                 workspace='',
                 schema='public',
                 vcluster='default')
  # 执行 SQL
  cursor = conn.cursor()
  my_param["hints"]["query_tag"] ="test"
  cursor.execute('select 1;', parameters=my_param)
  ```

在 Studio 的作业历史中过滤，当前只支持精确匹配。

![Image](.topwrite/assets/image_1702889439834.png)

借助query\_tag参数，您可以对作业进行分类和检索。在Lakehouse 的information\_schema查询过滤作业：

```sql
select * from information_schema.job_history where query_tag='aa';
```

在show jobs中可以过滤：

```sql
show jobs where query_tag='aa' limit 100 ;
```

desc jobs中也可以展示设置的query tag

```sql
desc job '202311281613333434l4r2v3c8ni0';
```

![Image](.topwrite/assets/image_1702889456850.png)

### cz.sql.double.quoted.identifiers

* 在 SQL 的 ANSI/ISO 标准中，双引号中的标识符（分隔标识符）允许用户可以写特殊字符或者关键字。Lakehouse也可以兼容此行为。
* 开启后双引号为分隔符标识符，SET cz.sql.double.quoted.identifiers=true 当前只支持会话级别开启。**需要特别注意的是，如果开启双引号为分隔符标识符后，Lakehouse 将不再把双引号括起来的数据认为是一个字符串类型。**

### cz.sql.cast.mode

* 开启cast strict模式后，显式转换无法转换的类型会报错，可以使用try\_cast函数
* 隐式转换行为无法转换的会报错。案例：比如 `select case when true then 'lakehouse' else nvl(null,-99) end;` 此案例中我们想返回 lakehouse 字符串。但是由于SQL写的不规范，nvl中是一个int类型，then中是一个string类型。按照类型优先级转换规则推测会认为整体应该返回一个int类型。上面是一个true会直接进入到true的输出中，由于`lakehouse`是一个字符串转换成int，系统默认行为会直接走try\_cast，lakehouse转换成int时则会变成null，会导致一些结果超出预期。如果严格模式，系统则不会自动走try\_cast会将异常抛出，告知用户这个SQL不是规范行为，如果确认逻辑正确，在开启ansi模式下添加try\_cast函数

```
select case when true then cast('lakehouse' as int) else nvl(null,-99) end;
select case when true then try_cast('123' as int) else nvl(null,-99) end;
```

### schedule\_job\_queue\_priority

**作业优先级**
用户提交的SQL作业会附带一个优先级设置，该设置决定了作业在队列中的执行顺序。系统会根据这些设置来确定哪些作业应该优先执行，并优先将它们下发到虚拟集群（VCLUSTER）进行处理。对于GP和AP类型的VCLUSTER，优先级设置决定了哪个作业首先被下发到VCLUSTER。在计算集群中有大量作业排队等待处理时，设置作业优先级尤为有效。

**作业优先级划分**

* 定义：作业优先级是一个数值，用于标识作业的执行顺序。
* 对应数字：数值范围从0到9，数值越大，表示优先级越高。

**作业优先级设置**

* SQL支持：用户可以在当前临时会话中修改作业的优先级，以便在提交作业时指定优先级。
* 设置语法：使用以下命令来设置作业优先级：

```sql
SET schedule_job_queue_priority = {优先级数值};
```

* 其中，{优先级数值}是一个介于0到9之间的整数。

**案例**

```scala
set schedule_job_queue_priority=2;
select current_timestamp();
```

以下是针对您提到的几个参数的案例：

### cz.sql.string.literal.escape.mode

**参数说明**：此参数用于控制字符串字面量的转义字符。默认使用反斜线（`\`）作为转义字符。

**案例**：

* 默认模式（backslash）：
  ```sql
  SELECT 'Hello \n World!' AS res;
  +---------+
  |   res   |
  +---------+
  | Hello 
   World!   |
  +---------+
  SELECT 'It''s a beautiful day' as res;
  +---------------------+
  |         res         |
  +---------------------+
  | Its a beautiful day |
  +---------------------+
  ```

* 引号模式(quote)：

  ```sql
  SET cz.sql.string.literal.escape.mode = QUOTE;
  SELECT 'It''s a beautiful day';
  +----------------------+
  |         res          |
  +----------------------+
  | It's a beautiful day |
  +----------------------+
  ```

  这个查询将返回字符串 `It's a beautiful day`。注意，这里使用了两个单引号 `''` 来表示一个单独的单引号。


* **同时支持引号和反斜线模式（quote_backslash）**：
  ```sql
  SET cz.sql.string.literal.escape.mode = quote_backslash;
  SELECT 'Hello \n World!' AS res,'It''s a beautiful day' as res2;
  +---------+---------------------+
  |   res   |        res2         |
  +---------+---------------------+
  | Hello 
   World! | Its a beautiful day |
  +---------+---------------------+

  ```
  在这个例子中，既可以使用反斜线转义特殊字符，也可以使用双引号来包含引号。

### cz.sql.arithmetic.mode

**参数说明**：此参数控制算术运算出错时是否抛出异常。默认为 `tolerant`，即不抛出异常。

**案例**：

* **tolerant模式（默认）**：
  ```sql
  SELECT 2/0 res;
  +------+
  | res  |
  +------+
  | null |
  +------+

  ```
  在这个例子中，除以 0 返回一个 `NULL` 或者一个溢出的值，而不是抛出异常。

* **strict模式**：
  ```sql
  SET cz.sql.arithmetic.mode = strict;
  SELECT 2/0 res;
  CZLH-22012:arithmetic divide by zero. Detail  taskId 0, vertex name=stg0, vertexId=2024121311314772461pl5i9617d2_94570-V0 (state=,code=0)
  ```
  在这个例子中，将会抛出一个异常，因为 `strict` 模式下不允许算术运算除以 0。

### cz.sql.timezone

**参数说明**：此参数用于设置 SQL 会话的[时区](https://data.iana.org/time-zones/tzdb-2021a/zone1970.tab)。

**案例**：

* **设置时区为UTC+08**：
  ```sql
  SET cz.sql.timezone = Asia/Shanghai;
  SELECT NOW() AS res;
  +---------------------------+
  |            res            |
  +---------------------------+
  | 2024-12-13 07:43:28.275429|
  +---------------------------+
  ```

* 在这个例子中，`NOW()` 函数将返回当前的日期和时间，根据 `Asia/Shanghai` 时区（UTC+08）进行调整。

* **设置时区为UTC**：
  ```sql
  SET cz.sql.timezone = UTC;
  SELECT NOW() AS res_utc;
  +----------------------------+
  |          res_utc           |
  +----------------------------+
  | 2024-12-13 07:43:46.791785 |
  +----------------------------+
  ```
  在这个例子中，`NOW()` 函数将返回当前的日期和时间，根据UTC时区进行调整。

### cz.sql.remote.udf.lookup.policy

**参数说明**：动态切换 UDF 与内置函数的解析优先级。

**案例**：

默认行为，使用UDF时必须带SCHEMA前缀

```sql
--创建函数
CREATE FUNCTION public.lower()
RETURNS STRING
AS 'Hello World!';
--使用函数，必须写SCHEMA否则会报错函数找不到
SELECT public.lower();
-- 策略1：优先调用内置函数，可以不用写SCHEMA。如果和内置函数同名优先使用内置函数
SET cz.sql.remote.udf.lookup.policy = builtin_first;
SELECT lower();
-- 策略2：优先调用UDF（适配MC/Spark作业场景）。如果和内置函数同名优先使用udf
SET cz.sql.remote.udf.lookup.policy = udf_first;
SELECT lower();
```

### cz.sql.translation.mode 【预览发布】本功能当前处于公开预览发布阶段。

**参数说明**：通过设置此参数，Lakehouse 可将指定 SQL 方言的语法自动转换为原生可执行语法，实现多方言兼容查询。本功能基于改进版 [SQLGlot](https://github.com/clickzetta/sqlglot-clickzetta) 实现，支持将常见数据库语法透明转换为 Lakehouse 原生语法，降低业务迁移成本。需要注意的是，并非支持全部的语法转换，只是部分语法可以转换。目前支持 PostgreSQL、MySQL、Doris、Hive、Presto。

**案例**：

设置Doris转化

```sql
--设置Doris转化
set cz.sql.translation.mode=doris;
SELECT DATE_ADD(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR);
```

DATE\_FORMAT 和 AES\_DECRYPT 函数需要指定 cz.sql.compatible.target 引擎兼容模式，以设置兼容 MySQL 或 PostgreSQL 的原始语义。

```sql
--兼容 mysql DATE_FORMAT 函数的原生语义
set cz.sql.compatible.target=mysql;
select DATE_FORMAT(CURRENT_DATE(), '%x-%v %a %W');

--兼容 pg DATE_FORMAT 函数的原生语义
set cz.sql.compatible.target=pg;
SELECT DATE_FORMAT(CURRENT_TIMESTAMP(), 'yyyy-"Q"Q')

--兼容 mysql AES_DECRYPT 函数的原生语义
set cz.sql.compatible.target=mysql;
SELECT CAST(AES_DECRYPT(UNBASE64('fOltPBoMXnbhu54SSxaaAQ=='), 'namePURPMEF4uI2mQSbrWOhpAvu6OGbE4U') AS STRING);
```

### cz.sql.type.conversion

**默认值**：无
**取值为 hive 时**：兼容 Hive 的类型转换规则。

用于兼容 Hive 的类型转换。由于 Lakehouse 和 Hive 的默认类型转换规则存在差异，设置此参数可使类型转换逻辑与 Hive 保持一致。详细的类型转换优先级规则可参考[类型转化](datatype-conversion.md)。

### cz.sql.function.from.unixtime.trim.to.second

**默认值**：false

控制 `FROM_UNIXTIME` 函数的精度处理。启用时，函数返回值将精度截断到秒级，与 Hive 的行为保持一致。

### cz.sql.time.parser.strict.mode

**默认值**：false

启用时间解析的严格模式。若时间格式与指定的格式模式不匹配，系统将抛出错误；禁用时则返回 `null`。

**示例**：

```sql
SET cz.sql.time.parser.strict.mode=true;
SELECT TO_TIMESTAMP('2025-08-01','yyyy-MM-dd HH');
执行结果: ❌ 错误发生

SET cz.sql.time.parser.strict.mode=false;
SELECT TO_TIMESTAMP('2025-08-01','yyyy-MM-dd HH');
执行结果: NULL
```

### cz.sql.cast.string.to.integer.allow\.truncate

**默认值**：false

控制字符串转整数时是否允许截断小数位。启用时，转换过程中的小数部分将被直接丢弃，与 Hive 的行为保持一致。

**示例**：

```sql
SELECT CAST('11.4' AS INT);
执行结果: NULL
SET cz.sql.cast.string.to.integer.allow.truncate=true;
SELECT CAST('11.4' AS INT) ;
执行结果:11
```



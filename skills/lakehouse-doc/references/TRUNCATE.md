# TRUNCATE TABLE

## 功能

`TRUNCATE TABLE` 命令用于快速删除表中的所有记录，但表结构及其属性将保持不变。与 `DROP TABLE` 命令不同，`TRUNCATE TABLE` 不会完全删除表，而仅删除表中的数据。

## 语法

```SQL
TRUNCATE TABLE  [ IF EXISTS ] table_name;
```

**必选参数**

* `table_name`：指定要清空数据的表名。

**可选参数**

* `IF EXISTS`：如果指定的表不存在，则不报错并继续执行其他操作。

## 使用示例

1. 清空名为 `employees` 的表中的所有记录：
   ```SQL
   TRUNCATE TABLE employees;
   ```

2. 清空表 `employees`，如果表不存在，则不报错：
   ```SQL
   TRUNCATE TABLE IF EXISTS employees;
   ```

# TRUNCATE TABLE PARTITION

## 功能

`TRUNCATE TABLE PARTITION` 命令用于清空分区表中指定分区的数据。支持通过条件筛选方式清空分区数据。如果您希望一次性清空符合某个规则条件的一个或多个分区，可以使用表达式指定筛选条件，通过筛选条件匹配分区并批量清空分区数据。

## 语法

* 指定分区删除：

```SQL
TRUNCATE TABLE <table_name> PARTITION (<pt_spec>)[, PARTITION (<pt_spec>)....];
```

* 指定分区筛选条件：

```SQL
TRUNCATE TABLE <table_name>  <partition_expression>;
partition_expression::=
   PARTITION (<partition_col> <relational_operators> <partition_col_value>)
   | PARTITION (scalar(<partition_col>) <relational_operators> <partition_col_value>)
   | PARTITION (<partition_filter> AND|OR <partition_filter>)
   | PARTITION (NOT <partition_filter>)
   | PARTITION (<partition_filter>)[,PARTITION (<partition_filter>), ...]
```

**参数说明**

* `table_name`：指定表的名字。
* `IF EXISTS`：如果表不存在，加上此参数执行该命令则不会报错。
* `pt_spec`：必填。待清空数据的分区。当有多个分区字段格式为`(partition_col1 = partition_col_value1, partition_col2 = partition_col_value2, ...)`。partition\_col是分区字段，partition\_col\_value是分区值。分区字段不区分大小写，分区值区分大小写。支持指定多个分区值，使用逗号分隔。
* `partition_expression`：可以包含以下几种形式：

  1. **基于分区列的比较操作**：

  ```SQL
  PARTITION (<partition_col> <relational_operators> <partition_col_value>)
  ```

  * `<partition_col>`：分区表中的分区列名。
  * `<relational_operators>`：关系运算符，如 `=`、<`、`>、<=`、`>、`<>`。
  * `<partition_col_value>`：与分区列进行比较的值。
  * 示例如下：

  ```SQL
  PARTITION (scalar(<partition_col>) <relational_operators> <partition_col_value>)
  ```

  * `scalar` 函数是返回单个值的函数，用于将分区列的值转换为标量值。目前lakehouse支持的分区scalar函数包含时间函数、json函数、数学函数、加密函数、正则函数、字符串函数。

  * 示例如下：

    ```
    TRUNCATE TABLE sales PARTITION (lower(pt)=product1);
    ```

  2. **基于分区过滤器的复合条件**：

  ```SQL
  PARTITION (<partition_filter> AND|OR <partition_filter>)
  ```

  * `<partition_filter>`：可以是任何有效的分区过滤条件。
  * `AND|OR`：逻辑运算符，用于组合多个过滤条件。
  * 示例如下：

    ```
    TRUNCATE TABLE sales  PARTITION(pt1='2023' and pt2='03');
    ```

  3. **基于分区过滤器的否定条件**：

  ```SQL
  PARTITION (NOT <partition_filter>)
  ```

  * `NOT`：逻辑非运算符，用于否定一个过滤条件。
  * 示例如下：

    ```
    TRUNCATE TABLE sales  PARTITION(pt2 not in('01','04'));
    ```

  4. **多个分区过滤器的列表**：

  ```SQL
  PARTITION (<partition_filter>)[,PARTITION (<partition_filter>), ...]
  ```

  * 允许您列出多个分区过滤条件，每个条件之间用逗号分隔。

## 使用示例

1. 指定分区清空
   ```sql
   --从表sale_detail中清空一个分区
   TRUNCATE  TABLE sale_detail PARTITION (pt = '202402', region = 'beijing');
   --从表sale_detail中同时清空两个分区，清空2024年1月杭州和上海地域的销售记录。
   TRUNCATE  TABLE sale_detail PARTITION (pt = '201401', region = 'hangzhou'),
   PARTITION (pt = '201401', region = 'shanghai');
   ```

2. 使用过滤条件清空 `sales` 表中满足分区条件 `year < 2024 AND quarter = 1` 的所有分区：
   ```SQL
   TRUNCATE  TABLE sales PARTITION 
   (
   YEAR < 2024 AND      
   QUARTER = 1
   );
   ```

^

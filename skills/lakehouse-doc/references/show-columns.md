## 概述

`SHOW COLUMNS` 是一种用于查看表中列信息的 SQL 命令。通过该命令，用户可以快速获取表的列名、数据类型等详细信息。

## 语法结构
```sql
SHOW COLUMNS
[ IN | FROM ]                 -- 使用 IN 或 FROM 关键字
[<schema_name>.]<table_name>  -- 带可选 Schema 前缀的表名
[IN <schema_name>]            -- 表名与 Schema 分离写法
```

## 参数详解

### 核心参数
| 参数格式                     | 是否必须 | 说明                                                                 |
|----------------------------|---------|--------------------------------------------------------------------|
| `<table_name>`             | 必需    | 目标表名称                                                          |
| `<schema_name>`            | 可选    | Schema 名称，支持两种指定方式：<br>1. 作为表名前缀 `schema.table`<br>2. 通过 `IN` 子句指定 |

## 使用规范
### 路径指定方式（二选一）
```sql
-- 方式1：Schema 与表名合并写法
SHOW COLUMNS IN sales.orders;

-- 方式2：Schema 与表名分离写法
SHOW COLUMNS FROM orders IN sales;
```

### 禁止用法示例
```sql
-- 错误！重复指定 Schema
SHOW COLUMNS IN sales.orders IN sales;

-- 错误！混合使用两种语法
SHOW COLUMNS FROM sales.orders IN production;
```


## 使用示例

查看当前模式下的表列信息：

```sql
SHOW COLUMNS IN household_demographics;
+-------------+------------------------+-------------------+-----------+---------+
| schema_name |       table_name       |    column_name    | data_type | comment |
+-------------+------------------------+-------------------+-----------+---------+
| tpcds_10tb  | household_demographics | hd_demo_sk        | int       |         |
| tpcds_10tb  | household_demographics | hd_income_band_sk | int       |         |
| tpcds_10tb  | household_demographics | hd_buy_potential  | string    |         |
| tpcds_10tb  | household_demographics | hd_dep_count      | int       |         |
| tpcds_10tb  | household_demographics | hd_vehicle_count  | int       |         |
+-------------+------------------------+-------------------+-----------+---------+
```

## 常见问题

Q1：如何查看表的详细信息（如表结构）？

* 使用 `DESCRIBE` 或 `SHOW CREATE TABLE` 命令：
  ```sql
  DESCRIBE public.household_demographics;
  SHOW CREATE TABLE public.household_demographics;
  ```

Q2：`SHOW COLUMNS` 是否支持过滤条件？

* 不支持直接过滤，但可以通过查询 `INFORMATION_SCHEMA.COLUMNS` 实现：
  ```sql
  SELECT * FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'household_demographics' AND COLUMN_NAME LIKE 'name%';
  ```


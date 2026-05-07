# 数据类型转换

在 SQL 语句中，数据类型转换是一项常见的操作。本文将介绍如何在 SQL 中进行数据类型转换，以及相关的函数和语法。

## 数据类型转换函数

### CAST 函数

CAST 函数用于将一个数据类型的值转换为另一个数据类型的值。如果转换过程中超出目标数据类型的范围，则会引发溢出异常。

#### 语法

```
CAST(expression AS type)
```

参数说明：

* expression：必填。待转换的数据源。
* type：必填。目标数据类型。用法如下：
  * `CAST(double AS bigint)`：将 DOUBLE 数据类型值转换为 BIGINT 数据类型。
  * `CAST(string AS bigint)`：将字符串转换为 BIGINT 数据类型。如果字符串中是整型表达的数字，则直接转换为 BIGINT 类型。如果字符串中是浮点数或指数形式表达的数字，则先转换为 DOUBLE 数据类型，再转换为 BIGINT 数据类型。
  * `CAST(string AS timestamp)` 或 `CAST(timestamp AS string)`：会采用默认的日期格式 `yyyy-MM-dd HH:mm:ss`。

#### 示例

```sql
SELECT CAST(rand() AS INT);
-- 执行结果 0
```

### TYPE(expr)

 函数用于将一个值从一种数据类型转换为另一种数据类型。如果转换成功，返回转换后的值；如果转换失败，默认返回 NULL。

#### 语法

```
TYPE(expr)
```

参数说明：

* TYPE类型：支持float\double\tinyint\smallint\int\bigint\string\date\timestamp\timestamp\_ntz\binary\boolean
* expr：必填。要转换的表达式。

#### 示例

```sql
SELECT binary('1');
-- 执行结果 [31]
```

```sql
SELECT INT(100.6);
-- 执行结果 100
```

## 转换运算符

除了使用函数进行数据类型转换外，还可以使用转换运算符。

### 语法

```
expression::type
```

* expression：必填。要转换的表达式。
* type：必填。目标数据类型。

### 示例

```sql
SELECT 123.45::INT;
-- 执行结果 123

SELECT '2021-08-15'::DATE;
-- 执行结果 2021-08-15
```

## 转换运算符

除了使用函数进行数据类型转换外，还可以使用转换运算符。

### 语法

```
expression::type
```

* expression：必填。要转换的表达式。
* type：必填。目标数据类型。

### 示例

```
SELECT 123.45::INT;
-- 执行结果 123

SELECT '2021-08-15'::DATE;
-- 执行结果 2021-08-15
```



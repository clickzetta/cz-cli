# CREATE SQL FUNCTION

## 概述

`CREATE FUNCTION` 语句用于在 Lakehouse 中创建 SQL 标量函数或表函数。这些函数可以接受一组参数，并返回标量值或一组行。本文将详细介绍其语法、参数、使用示例。

## 语法

```sql
CREATE [OR REPLACE] FUNCTION [IF NOT EXISTS]
    function_name ( [ function_parameter [, ...] ] )
     [ RETURNS data_type | RETURNS TABLE(column_spec)]
   AS|RETURN { expression | query };

function_parameter
    parameter_name data_type ;

column_spec
    column_name data_type ;
```

## 参数说明

* `OR REPLACE`
  * 如果指定此参数，将替换具有相同名称和签名（参数数量和类型）的现有函数。
  * 不能与 `IF NOT EXISTS` 同时使用。
* `IF NOT EXISTS`:如果指定，仅在函数不存在时才会创建。
* `function_name`:函数的名称，可以使用schema名称限定。
* `function_parameter`
  * `parameter_name`：参数名称必须在函数中唯一。
  * `data_type`：支持的任何数据类型。
* `RETURNS data_type`
  * 标量函数的返回数据类型。如果未提供数据类型，将从函数体派生。
* `RETURNS TABLE`：定义返回表结构，需指定列名和数据类型
* `AS|RETURN {expression | query}`
  * 函数的主体。对于标量函数，可以是表达式或查询；对于表函数，只能是查询。


## 示例

* 创建和使用 SQL 标量函数

```sql
-- 创建一个函数,指定返回值
CREATE FUNCTION public.area(x DOUBLE, y DOUBLE) 
RETURNS DOUBLE
RETURN x * y;
-- 在查询中使用函数
SELECT public.area(3, 4);
-- 输出：12.0

-- 创建一个函数,使用AS指定处理逻辑
CREATE FUNCTION public.area2(x DOUBLE, y DOUBLE)
RETURNS double
AS x * y;
SELECT public.area2(3, 4);

```

* 指定返回类型

```
CREATE  FUNCTION public.hello()
RETURNS STRING
AS  'Hello World!';
SELECT public.hello();
```

* 在expression使用内置函数

```sql
CREATE FUNCTION public.roll_dice(num_dice INT  ,
                          num_sides INT   )
RETURNS INT
COMMENT 'Roll a number of n-sided dice'
RETURN (rand() * num_sides)::INT + 1;
SELECT public.roll_dice(3, 10);
```

* 返回一个返回表类型

```
CREATE TABLE employee (
    id INT,
    name STRING,
    deptno INT
);
INSERT INTO employee (id, name, deptno)
VALUES
    (1, 'Alice', 10),
    (2, 'Bob', 10),
    (3, 'Charlie', 20),
    (4, 'David', 10),
    (5, 'Eve', 20);
CREATE OR REPLACE FUNCTION ga1_1.getemps(deptno INT)
    RETURNS TABLE (name STRING)
    RETURN SELECT name FROM employee e WHERE e.deptno = deptno;
SELECT * FROM ga1_1.getemps(10);
```

## 注意事项

* 使用函数时必须指定创建时函数所在的Schema否则会错函数找不到。
  您可以通过设置参数来cz.sql.remote.udf.lookup.policy避免报错。该参数是。动态切换 UDF 与内置函数的解析优先级。默认行为，使用UDF时必须带SCHEMA前缀，如下案例
  ```
  --创建函数
  CREATE FUNCTION public.lower()
  RETURNS STRING
  AS 'Hello World!';
  --使用函数，必须写SCHMA否则会报错函数找不到
  SELECT public.lower();
  -- 策略1：优先调用内置函数,可以不用写SCHMA。如果和内置函数同名优先使用内置函数
  SET cz.sql.remote.udf.lookup.policy = builtin_first;
  SELECT lower();
  -- 策略2：优先调用UDF（适配MC/Spark作业场景）。如果和内置函数同名优先使用udf
  SET cz.sql.remote.udf.lookup.policy = udf_first;
  SELECT lower();
  ```



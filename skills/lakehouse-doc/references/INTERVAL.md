# INTERVAL

# INTERVAL 数据类型

Lakehouse 提供了 INTERVAL 数据类型，用来表示两个日期或时间之间的时间间隔。本文为您介绍 INTERVAL 类型的使用方法和语法。

## 使用说明

INTERVAL数据类型支持两种类型的间隔：

* INTERVAL\_YEAR\_MONTH：表示年月间隔，使用YEAR和MONTH字段存储时间间隔。
* INTERVAL\_DAY\_TIME：表示日间间隔，使用包括小数秒在内的天、小时、分钟和秒存储间隔。

### INTERVAL\_YEAR\_MONTH

#### 语法格式

| 语法                                  | 描述               | 示例                                       |
| ----------------------------------- | ---------------- | ---------------------------------------- |
| INTERVAL '\[+ \| -]-' YEAR TO MONTH | 同时指定YEAR和MONTH间隔 | INTERVAL '2-3' YEAR TO MONTH&#xA;表示2年3个月 |
| INTERVAL '\[+ \| -]' YEAR           | 仅指定YEAR间隔        | INTERVAL '2' YEAR&#xA;表示2年               |
| INTERVAL '\[+\| -]' MONTH           | 仅指定MONTH间隔       | INTERVAL '3' MONTH&#xA;表示3个月             |
| INTERVAL '[+\|-]' QUARTER (新增) | 支持季度作为独立单位 | INTERVAL '4' QUARTER 表示4个季度（1年） |


###


#### 参数说明

* year：取值范围为\[0, 9999]。
* month：取值范围为\[0, 11]。
* quarter：季度单位标识。1 QUARTER = 3 MONTH = 1/4 YEAR。支持范围：任意正整数或负整数。自动转换为 MONTH 进行计算。


#### 注意事项

* 仅指定 MONTH 间隔时，month 取值可以超过 11，超过部分会折算为 YEAR。

### INTERVAL\_DAY\_TIME

#### 语法格式

| 语法                                  | 描述                           | 示例                                                        |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------- |
| INTERVAL '\[+ \| -]' DAY            | 仅指定DAY间隔                     | INTERVAL '1' DAY表示1天                                      |
| INTERVAL '\[+ \| -]' HOUR           | 仅指定HOUR间隔                    | INTERVAL '23' HOUR表示23小时                                  |
| INTERVAL '\[+ \| -]' MINUTE         | 仅指定MINUTE间隔                  | INTERVAL '59' MINUTE表示59分钟                                |
| INTERVAL '\[+ \| -]' SECOND         | 仅指定SECOND间隔                  | INTERVAL '59.999' SECOND表示59.999秒                         |
| INTERVAL '\[+ \| -] ' DAY TO HOUR   | 同时指定DAY和HOUR间隔               | INTERVAL '1 23' DAY TO HOUR表示1天23小时                       |
| INTERVAL '\[+ \| -] ' DAY TO MINUTE | 同时指定DAY、HOUR和MINUTE间隔        | INTERVAL '1 23:59' DAY TO MINUTE表示1天23小时59分钟              |
| INTERVAL '\[+ \| -] ' DAY TO SECOND | 同时指定DAY、HOUR、MINUTE和SECOND间隔 | INTERVAL '1 23:59:59.999' DAY TO SECOND表示1天23小时59分59.999秒 |

* 允许 `INTERVAL expr unit` 时间间隔书写表达式，如：

```
select interval 1+2 year as res;
+-----+
| res |
+-----+
| 3-0 |
+-----+

```

#### 参数说明

* day：取值范围为\[0, 2147483647]。
* hour：取值范围为\[0, 23]。
* minute：取值范围为\[0, 59]。
* second：取值范围为\[0, 59.999999999]。

#### 注意事项

* 仅指定 HOUR/MINUTE/SECOND 间隔时，对应参数的取值可以超过范围上限，超过的部分会被折算为更大的单位。

## interval 类型的运算

INTERVAL 类型可以与数值类型、日期时间类型进行一些简单的算术运算。

```JavaScript
> SELECT INTERVAL 4 DAY * 2, INTERVAL 4 DAY  / 2;
8 00:00:00.000000000    2 00:00:00.000000000

> SELECT timestamp '2019-10-15' - timestamp '2019-10-14', date '2020-10-15' - date '2019-10-14';
1 00:00:00.000000000    367 00:00:00.000000000

> SELECT timestamp '2020-10-10' + INTERVAL 1 DAY, date '2020-10-10' + INTERVAL 1 MONTH;
2020-10-11 00:00:00     2020-11-10

> SELECT INTERVAL 1 DAY < INTERVAL 2 DAY;
true
```

## interval 类型写法更宽松

```
SELECT    interval 7 week;
+--------------------------------------+
| INTERVAL '49 00:00:00' DAY TO SECOND |
+--------------------------------------+
| 49 00:00:00.000000000                |
+--------------------------------------+

```

INTERVAL 可以写在整个字符串中

```
SELECT    'interval 7 week';
+-------------------+
| 'interval 7 week' |
+-------------------+
| interval 7 week   |
+-------------------+

```

INTERVAL 数字可以写到字符串中

```
SELECT    interval '7' week;
+--------------------------------------+
| INTERVAL '49 00:00:00' DAY TO SECOND |
+--------------------------------------+
| 49 00:00:00.000000000                |
+--------------------------------------+

```

数字和时间单位可以写在整个字符串中

```
SELECT    interval '7 week';
+--------------------------------------+
| INTERVAL '49 00:00:00' DAY TO SECOND |
+--------------------------------------+
| 49 00:00:00.000000000                |
+--------------------------------------+

```

^

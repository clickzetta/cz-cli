### TIMESTAMPDIFF 函数

```sql
TIMESTAMPDIFF(unit, startTimestamp, endTimestamp)
```

#### 功能描述

TIMESTAMPDIFF 函数用于计算两个时间戳（startTimestamp 和 endTimestamp）之间的时间差，并以指定的单位（unit）返回结果。该函数支持多种时间单位，包括微秒（MICROSECOND）、毫秒（MILLISECOND）、秒（SECOND）、分钟（MINUTE）、小时（HOUR）、天（DAY）、周（WEEK）、月（MONTH）、季度（QUARTER）和年（YEAR）。

#### 参数说明

* `unit`：所需时间差的单位，可选值包括 `MICROSECOND`（微秒）、`MILLISECOND`（毫秒）、`SECOND`（秒）、`MINUTE`（分钟）、`HOUR`（小时）、`DAY`（天）、`WEEK`（周）、`MONTH`（月）、`QUARTER`（季度）和 `YEAR`（年）。
* `startTimestamp`：开始时间戳，需为 timestamp 类型。
* `endTimestamp`：结束时间戳，需为 timestamp 类型。

#### 返回结果

返回一个整型数值，表示从 `startTimestamp` 到 `endTimestamp` 之间的时间差，单位由参数 `unit` 决定。

#### 使用示例

1. 计算两个时间戳之间相差的微秒数：

```sql
SELECT TIMESTAMPDIFF(MICROSECOND, '2022-03-31 00:00:00', '2022-03-30 06:00:00') as res;
+--------------+
|     res      |
+--------------+
| -64800000000 |
+--------------+
```

2. 计算两个时间戳之间相差的小时数：

```sql
SELECT TIMESTAMPDIFF(HOUR, '2022-03-31 00:00:00', '2022-03-30 06:00:00') as res ;
+-----+
| res |
+-----+
| -18 |
+-----+
```

3. 计算两个时间戳之间相差的天数：

```sql
SELECT TIMESTAMPDIFF(DAY, '2022-03-31 00:00:00', '2022-03-30 06:00:00') as res;
+-----+
| res |
+-----+
| 0   |
+-----+
```

4. 计算两个时间戳之间相差的月份数：

```sql
SELECT TIMESTAMPDIFF(MONTH, '2022-03-31 00:00:00', '2022-02-28 06:00:00')as res;
+-----+
| res |
+-----+
| -1  |
+-----+
```

5. 计算两个时间戳之间相差的年数：

```sql
SELECT TIMESTAMPDIFF(YEAR, '2022-03-31 00:00:00', '2021-03-30 06:00:00') as res;
+-----+
| res |
+-----+
| -1  |
+-----+
```



### YEAROFWEEK 函数

```
yearofweek(expr)
```

#### 功能描述

YEAROFWEEK 函数用于返回给定日期（expr）对应的 ISO 周编号年份。ISO 周编号年份是根据国际标准 ISO 8601 进行计算的，该标准将每周的第一天设为周一。

#### 参数说明

* expr：传入的日期或时间戳，类型为 date 或 timestamp\_ltz。

#### 返回结果

返回一个整型数值，表示给定日期所在的 ISO 周编号年份。

#### 使用示例

1. 根据当前时间获取 ISO 周编号年份：

```
SELECT YEAROFWEEK(NOW()) as res;
+------+
| res  |
+------+
| 2025 |
+------+
```

2. 计算指定日期所在的 ISO 周编号年份：

```
SELECT YEAROFWEEK('2022-03-31')as res;
+------+
| res  |
+------+
| 2022 |
+------+
```

3. 计算某个时间戳所在的 ISO 周编号年份：

```
SELECT YEAROFWEEK(TIMESTAMP "2022-03-31 03:21:00")as res;
+------+
| res  |
+------+
| 2022 |
+------+
```

4. 计算并比较两个不同日期的 ISO 周编号年份：

```
SELECT YEAROFweek('2022-03-31') AS year1, YEAROFweek('2023-03-31') AS year2;
+-------+-------+
| year1 | year2 |
+-------+-------+
| 2022  | 2023  |
+-------+-------+
```


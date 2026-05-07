### DATEDIFF 函数

#### 功能描述
DATEDIFF 函数用于计算两个日期之间的时间差值。该函数支持多种时间单位，包括微秒（MICROSECOND）、毫秒（MILLISECOND）、秒（SECOND）、分（MINUTE）、小时（HOUR）、天（DAY）、周（WEEK）、月（MONTH）、季度（QUARTER）和年（YEAR）。

#### 语法
```
DATEDIFF(unit, startTimestamp, endTimestamp)
```
或
```
DATEDIFF(endDate, startDate)
```

#### 参数说明
- `unit` (字符串): 指定计算时间差值的单位，可选值包括：MICROSECOND, MILLISECOND, SECOND, MINUTE, HOUR, DAY, WEEK, MONTH, QUARTER, YEAR。
- `startTimestamp` (时间戳): 计算开始的时间戳。
- `endTimestamp` (时间戳): 计算结束的时间戳。
- `endDate` (日期): 计算结束的日期。
- `startDate` (日期): 计算开始的日期。

#### 返回结果
返回一个整数，表示两个时间戳或日期之间的时间差值。

#### 使用示例
1. 计算两个日期之间的天数差：
```sql
SELECT DATEDIFF('2022-03-31', '2022-03-30'); -- 返回结果为 1
```
2. 计算两个时间戳之间的小时数差：
```sql
SELECT DATEDIFF(HOUR, '2022-03-31 00:00:00', '2022-03-30 06:00:00'); -- 返回结果为 -18
```
3. 计算两个时间戳之间的毫秒数差：
```sql
SELECT DATEDIFF(MILLISECOND, '2022-03-30 10:30:00', '2022-03-30 10:30:10'); -- 返回结果为 10000
```
4. 计算两个日期之间的季度数差：
```sql
SELECT DATEDIFF(QUARTER, '2022-01-15', '2022-10-20'); -- 返回结果为 3
```
5. 计算两个时间戳之间的分钟数差：
```sql
SELECT DATEDIFF(MINUTE, '2022-03-30 08:45:00', '2022-03-30 09:30:00'); -- 返回结果为 45
```

#### 注意事项
- 当使用 DATEDIFF 函数计算时间戳之间的时间差时，请注意时间戳的格式必须正确。
- 当使用日期参数时，请确保日期格式正确，否则可能导致计算结果不准确。
- 在计算时间差时，请注意负数结果表示 `startTimestamp` 或 `startDate` 晚于 `endTimestamp` 或 `endDate`。
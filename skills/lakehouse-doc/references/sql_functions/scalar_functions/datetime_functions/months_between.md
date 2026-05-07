### MONTH
```sql
months_between(timestamp1, timestamp2[, roundOff]) 
```
#### 功能
返回两个日期之间的月份数。
如果 timestamp1 晚于 timestamp2，则结果是正值。
时分秒部分的差异基于每月 31 天计算。如果 timestamp1 和 timestamp2 的日相同（例如都是 5 号），或者都是各自月份的最后一天，那么时分秒部分会被忽略。
当 roundOff 为 true（或未指定）时，结果会保留 8 位小数。
#### 返回结果
double
#### 举例
```sql
> SELECT months_between('1997-02-28 10:30:00', '1996-10-30');
3.94959677
> SELECT months_between('1997-02-28 10:30:00', '1996-10-30', false);
3.9495967741935485
```

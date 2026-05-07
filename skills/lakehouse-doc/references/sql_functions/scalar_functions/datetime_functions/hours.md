### HOURS
```sql
hours(expr)
```
#### 功能
返回从 epoch (1970-01-01 00:00:00) 到指定时间戳之间的小时数。
#### 参数
* `expr`: date/timestamp_ltz/timestamp_ntz 类型的表达式
#### 返回结果
* `bigint` 类型，表示从 epoch 开始的小时数。
#### 举例
```sql
> SELECT hours(timestamp_ntz '1970-01-01 00:00:00');
0

> SELECT hours(timestamp_ntz '2000-01-01 00:00:00');
262968

> SELECT hours(timestamp_ntz '2020-08-09 03:04:05');
443595
```

### TO_START_OF_INTERVAL
```sql
to_start_of_interval(ts， interval)
```
#### 功能
将时间 ts 按照 interval 截断。注意当 interval 为分钟时，需要保证其能被 1 天整除。

#### 参数
* `ts` timestamp
* `interval` interval_day_time/interval_year_month
#### 返回结果
timestamp
#### 举例
```sql
> select
  to_start_of_interval(ts, interval 5 minute),
  to_start_of_interval(ts, interval 1 day)
  from values
   (timestamp '1933-06-22 04:44:08.999'),
   (timestamp '1970-12-31 04:59:59.999'),
   (timestamp '1996-03-31 07:03:33.123') t(ts);
1933-06-22 04:40:00     1933-06-22 00:00:00
1970-12-31 04:55:00     1970-12-31 00:00:00
1996-03-31 07:00:00     1996-03-31 00:00:00
```
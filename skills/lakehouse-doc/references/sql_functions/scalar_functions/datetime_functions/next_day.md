### MONTH
```sql
next_day(start_date, day_of_week)
```
#### 功能
返回start_date之后第一次出现day_of_week的日期。
#### 参数
- start_date：date类型
- day_of_week：string，表示星期几，可以使用简写，例如'TU', 'TUE', 'TUESDAY'均表示星期二。
#### 返回结果
date
#### 举例
```sql
> SELECT next_day('2015-01-14', 'TU');
2015-01-20
```

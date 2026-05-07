### CURRENT_DATE 函数
```
CURRENT_DATE()
```
#### 功能描述
CURRENT_DATE 函数是一个非确定性函数，用于返回执行查询时的当前日期。需要注意的是，在整个查询过程中，多次调用 CURRENT_DATE() 将返回相同的结果。

#### 参数
该函数不需要任何参数。

#### 返回结果
返回值类型为日期（date）。

#### 使用示例
以下示例将帮助您更好地理解 CURRENT_DATE 函数的用法：

1. 查询当前日期：
   ```sql
   SELECT CURRENT_DATE();
   ```
   结果：
   ```
   2022-01-01
   ```

2. 在更复杂的查询中使用当前日期：
   ```sql
   SELECT user_id, order_date, current_date() - INTERVAL 7 DAY AS week_ago_date
   FROM orders;
   ```
   结果：
   ```
   +-----------+------------+-------------------+
   | user_id  | order_date | week_ago_date    |
   +-----------+------------+-------------------+
   | 1         | 2022-01-05 | 2021-12-25         |
   | 2         | 2022-01-03 | 2021-12-27         |
   | 3         | 2021-12-29 | 2021-12-22         |
   +-----------+------------+-------------------+
   ```

3. 筛选出在过去一周内下单的用户：
   ```sql
   SELECT user_id, order_date
   FROM orders
   WHERE order_date >= CURRENT_DATE() - INTERVAL 1 WEEK;
   ```
   结果：
   ```
   +-----------+------------+
   | user_id  | order_date |
   +-----------+------------+
   | 1         | 2022-01-05 |
   | 4         | 2022-01-02 |
   +-----------+------------+
   ```
### HOUR 函数

#### 简介
HOUR 函数用于从给定的 timestamp 类型表达式中提取小时部分。该函数对于处理时间数据和计算时间间隔等场景非常有用。

#### 语法
```sql
hour(timestamp_ltz) 
```

#### 参数
- `timestamp_ltz`: 表示待提取小时部分的 timestamp 类型表达式。

#### 返回结果
返回一个整数，表示输入表达式的小时部分。

#### 使用示例

1. 从当前时间戳中提取小时部分：
```sql
SELECT hour( NOW());
```
这将返回当前时间的小时部分。

2. 从指定时间戳中提取小时部分：
```sql
SELECT hour(TIMESTAMP  '2022-01-01 10:00:00');
```
这将返回 10，表示指定时间的小时部分。

3. 从一个包含时间戳的表中提取小时部分：
假设我们有一个名为 `orders` 的表，其中包含一个名为 `order_time` 的 timestamp 类型列。我们可以提取每个订单的小时部分，如下所示：
```sql
SELECT order_id, hour(order_time) as hour
FROM orders;
```
这将返回 `orders` 表中每个订单的 ID 和小时部分。

4. 与其他时间函数结合使用：
```sql
SELECT order_id, 
       hour(order_time) as hour, 
       day(order_time) as day, 
       month(order_time) as month
FROM orders;
```
这将返回 `orders` 表中每个订单的 ID、小时部分、日和月份。

通过以上示例，您可以看到 HOUR 函数在处理时间数据时的灵活性和实用性。使用 HOUR 函数可以帮助您更轻松地从时间戳中提取所需的小时部分，以便进行进一步的分析和计算。
### MONTH 函数
```sql
MONTH(date)
```
#### 功能描述
MONTH 函数用于从给定的日期值中提取出月份部分，并以整数形式返回结果。

#### 参数说明
* **date** (date): 需要提取月份的日期值。

#### 返回结果
返回一个整数，表示参数 date 中的月份部分。

#### 使用示例
1. 从当前时间戳中提取月份：
```sql
SELECT MONTH(TIMESTAMP());
```
2. 从指定的字符串格式日期中提取月份：
```sql
SELECT MONTH('2022-04-01');
```
结果为：4

3. 从当前时间戳中提取月份，并与去年同月进行比较：
```sql
SELECT MONTH(CURRENT_TIMESTAMP()) - MONTH(CURRENT_TIMESTAMP()- INTERVAL '1 YEAR');
```
结果为：0

4. 从多个不同格式的日期值中提取月份，并汇总结果：
```sql
SELECT MONTH('2022-04-01'), MONTH('01-APR-2022'), MONTH('2022/04/01');
```
结果为：4, null, null

#### 注意事项
* 当输入的参数不是有效的日期值时，MONTH 函数将返回错误。
* 请确保输入的日期格式与系统支持的日期格式相匹配，以避免解析错误。
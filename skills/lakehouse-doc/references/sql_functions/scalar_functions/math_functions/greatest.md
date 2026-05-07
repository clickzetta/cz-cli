### GREATEST 函数
```
greatest(expr1[, expr2, ...])
```
#### 功能描述
GREATEST 函数用于从给定的参数列表中找出并返回最大值。若参数中存在 NULL 值，则会忽略 NULL 值。

#### 参数说明
- `expr`：可比较类型的数据，包括但不限于以下类型：
  - 数值类型：float、double、decimal、tinyint、smallint、int、bigint
  - 字符串类型：char、varchar、string
  - binary 类型
  - 时间类型：date、timestamp

#### 返回结果
返回值的类型与输入参数 expr 的类型相同。

#### 使用示例
1. 数值类型比较：
```sql
SELECT greatest(10, 9, 1, 4, -1, null);
-- 返回结果：10
```
2. 字符串类型比较：
```sql
SELECT greatest('apple', 'orange', 'banana', null);
-- 返回结果：'orange'
```
3. 时间类型比较：
```sql
SELECT greatest('2023-01-01', '2022-12-31', null, '2023-02-01');
-- 返回结果：'2023-02-01'
```

#### 注意事项
- 当所有参数都为 NULL 时，GREATEST 函数返回 NULL。

### LEAST 函数
```
least(expr1[, expr2, ...])
```
#### 功能描述
LEAST 函数用于从给定的参数列表中找出并返回最小值。如果参数列表中有 NULL 值，则该 NULL 值会被忽略。

#### 参数说明
* `expr`：可比较类型的表达式，包括但不限于数值类型（float、double、decimal、tinyint、smallint、int、bigint）、字符串类型（char、varchar、string）以及时间类型（date、timestamp）等。

#### 返回结果
返回值的类型与输入参数 expr 的类型相同。

#### 使用示例
1. 数值类型的比较：
```sql
SELECT least(10, 9, 1, 4, -1, null);
-- 返回结果：-1
```
2. 字符串类型的比较：
```sql
SELECT least('apple', 'banana', 'cherry', null);
-- 返回结果：'apple'
```
3. 时间类型的比较：
```sql
SELECT least('2023-01-01', '2022-12-31', null, '2024-01-01');
-- 返回结果：'2022-12-31'
```
4. 混合类型的比较：
```sql
SELECT least(100, '10', 10.5, '1', null);
-- 返回结果：'1'（字符串类型，但数值较小）
```
#### 注意事项
* 当所有参数都为 NULL 时，LEAST 函数将返回 NULL。
* LEAST 函数在比较字符串时对大小写敏感，因此需要注意大小写的影响。
* 不支持比较不同类型的数据。建议在使用 LEAST 函数时，确保所有参数类型一致。
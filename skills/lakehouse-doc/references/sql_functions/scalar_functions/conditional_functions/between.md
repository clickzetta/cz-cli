### BETWEEN 操作符

#### 功能描述
BETWEEN 操作符用于判断某个表达式（expr1）是否处于另外两个表达式（expr2 和 expr3）之间的范围内。如果 expr1 的值在 expr2 和 expr3 之间（包括 expr2 和 expr3），则返回 true，否则返回 false。

#### 语法
```sql
expr1 [NOT] BETWEEN expr2 AND expr3
```

#### 参数说明
- `expr1`: 需要判断的表达式，可以是小整数（smallint）、 tinyint、整数（int）、大整数（bigint）、浮点数（float）、双精度浮点数（double）、十进制数（decimal）、日期（date）、字符串（string）、字符（char）或可变长字符串（varchar）类型。
- `expr2`: 范围的起始值，与 expr1 进行比较的表达式。
- `expr3`: 范围的结束值，与 expr1 进行比较的表达式。
- `NOT` (可选): 使用 NOT 关键字表示对结果取反，即如果 expr1 不在 expr2 和 expr3 之间，则返回 true。

#### 返回结果
返回一个布尔值（boolean），表示 expr1 是否在 expr2 和 expr3 之间。

#### 使用示例
1. 判断数字是否在指定范围内：
   ```sql
   > SELECT 5 BETWEEN 3 AND 7;
   true
   ```
   上述示例中，数字 5 在 3 和 7 之间，所以返回 true。

2. 判断字符串是否在指定范围内：
   ```sql
   > SELECT 'C' BETWEEN 'A' AND 'E';
   true
   ```
   上述示例中，字符串 'C' 在 'A' 和 'E' 之间，所以返回 true。

3. 判断日期是否在指定范围内：
   ```sql
   > SELECT '2021-08-01' BETWEEN '2021-01-01' AND '2021-12-31';
   true
   ```
   上述示例中，日期 '2021-08-01' 在 '2021-01-01' 和 '2021-12-31' 之间，所以返回 true。

4. 使用 NOT 关键字判断 expr1 是否不在 expr2 和 expr3 之间：
   ```sql
   > SELECT 0 NOT BETWEEN 1 AND 3;
   true
   ```
   上述示例中，数字 0 不在 1 和 3 之间，使用 NOT 关键字后返回 true。

#### 注意事项
- 当 expr2 和 expr3 的类型不一致时，系统会尝试进行隐式类型转换，以满足操作符的要求。
- 对于字符串类型的参数，比较时会按照字典序进行。
- 对于日期类型的参数，比较时会考虑日期的先后顺序。

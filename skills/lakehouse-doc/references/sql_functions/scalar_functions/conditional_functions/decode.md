### DECODE 函数
```
DECODE(expr, search1, result1 [, search2, result2,] ... [, default])
```
#### 功能描述
DECODE 函数是一个条件表达式函数，它根据给定的 expr 表达式与 searchN 条件表达式的匹配结果，返回对应的 resultN 结果表达式。当 expr 与任一 searchN 相等时，返回相应的 resultN。如果 expr 与所有 searchN 都不相等，并且提供了 default 默认结果表达式，则返回 default。如果没有提供 default，则返回 null。

在进行比较时，null 和 null 被认为是相等的。

#### 参数说明
- expr：任意类型的待匹配表达式。
- searchN：与 expr 类型相同的判断条件表达式，用于与 expr 进行比较。
- resultN：结果表达式，其类型需与 searchN 相同。
- default（可选）：默认结果表达式，当 expr 与所有 searchN 都不相等时返回该值，类型需与 resultN 相同。

#### 使用示例
1. 基本使用：
   ```sql
   SELECT DECODE(3, 6, 'Lakehouse', NULL, 'SQL', 4, 'compiler');
   -- 结果：'compiler'
   ```
   在这个例子中，expr 为 3，与 search1（6）不相等，但与 search2（4）相等，因此返回 result2（'compiler'）。

2. 使用默认值：
   ```sql
   SELECT DECODE(5, 6, 'Lakehouse', NULL, 'SQL', 4, 'compiler', 'default');
   -- 结果：'default'
   ```
   当 expr 为 5 时，与所有 searchN 都不相等，因此返回指定的 default 值（'default'）。

3. 处理 null 值：
   ```sql
   SELECT DECODE(NULL, NULL, 'Lakehouse', 6, 'SQL', NULL, 'default');
   -- 结果：'Lakehouse'
   ```
   在这个例子中，expr 为 null，与 search1（null）相等，因此返回 result1（'Lakehouse'）。

4. 结合其他函数使用：
   ```sql
   SELECT DECODE(SUBSTR('Hello World', 1, 1), 'H', 'Yes', 'W', 'No', 'default');
   -- 结果：'Yes'
   ```
   在这个例子中，我们使用 SUBSTR 函数获取字符串 'Hello World' 的第一个字符 'H'，然后使用 DECODE 函数判断该字符是否为 'H'。因为 expr 与 search1 相等，所以返回 result1（'Yes'）。

通过以上示例，您可以更好地理解 DECODE 函数的用法和功能。请根据您的实际需求调整参数和表达式。
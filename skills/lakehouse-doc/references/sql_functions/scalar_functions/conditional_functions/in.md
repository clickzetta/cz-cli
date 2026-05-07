### IN 运算符

#### 功能描述
IN 运算符用于检查某个指定的值（elem）是否在给定的表达式列表（expr1, expr2, ...）或查询结果中。如果 elem 与列表中的任意一个值或查询结果中的某个值相等，则返回 true，否则返回 false。

#### 参数说明
- `elem`：任意返回可比较类型的表达式。
- `exprN`：与 `elem` 相同类型的表达式，可以有多个，用逗号分隔。
- `query`：返回类型与 `elem` 类型相同的查询语句，当前版本仅支持查询返回一列结果。

#### 返回类型
返回值类型为布尔值（boolean）。

#### 使用示例

1. 检查数字 1 是否在给定的列表中（1, 2, 3）：
   ```sql
   SELECT 1 IN (1, 2, 3); -- 结果为 true
   ```

2. 检查字符串 "apple" 是否在水果列表中：
   ```sql
   SELECT 'apple' IN ('banana', 'apple', 'orange'); -- 结果为 true
   ```

3. 通过查询判断某个学生的成绩是否及格（假设成绩大于等于 60 分为及格）：
   ```sql
   SELECT student_id IN (SELECT student_id FROM scores WHERE score >= 60); -- 结果取决于学生的成绩数据
   ```

#### 注意事项
- 请确保 `elem` 与 `exprN` 或 `query` 返回的类型相匹配，否则可能导致比较失败。
- 当使用 IN 运算符与子查询一起使用时，请确保子查询仅返回一列结果。

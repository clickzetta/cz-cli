### BIT_COUNT 函数

#### 概述
`BIT_COUNT` 函数用于计算给定整数表达式中非零位的数量。该函数对于分析数据的位模式非常有用。

#### 语法
```
BIT_COUNT(expr)
```

#### 参数
- `expr`: 可以是任何整数类型的表达式，包括 `TINYINT`、`SMALLINT`、`INT` 和 `BIGINT`。

#### 返回结果
返回一个 `INT` 类型的值，表示输入表达式中非零位的数量。

#### 使用示例
1. 计算正整数的非零位数量：
   ```sql
   SELECT BIT_COUNT(100); -- 返回 3，因为二进制表示为 1100100
   ```

2. 计算负整数的非零位数量：
   由于不同系统对负数的表示方式不同（如二进制补码），计算结果可能与预期有所差异。在 LakeHouse 中，可以通过显式转换为特定长度的整数类型来获得一致的结果。
   ```sql
   SELECT BIT_COUNT(-100), BIT_COUNT(CAST(-100 AS TINYINT)), BIT_COUNT(CAST(-100 AS SMALLINT)), BIT_COUNT(CAST(-100 AS INT)), BIT_COUNT(CAST(-100 AS BIGINT));
   -- 返回 28, 4, 12, 28, 60
   ```

3. 计算不同整数类型的非零位数量：
   ```sql
   SELECT BIT_COUNT(CAST(123 AS TINYINT)), BIT_COUNT(CAST(123 AS SMALLINT)), BIT_COUNT(CAST(123 AS INT)), BIT_COUNT(CAST(123 AS BIGINT));
   -- 返回 4, 4, 4, 4
   ```

4. 对于包含多个整数的列，可以逐个计算它们的非零位数量：
   ```sql
   SELECT BIT_COUNT(col1), BIT_COUNT(col2) FROM table_name;
   ```

#### 注意事项
- 当计算负整数的非零位数量时，请注意不同系统可能导致结果的差异。为了确保结果的一致性，建议显式指定整数类型。
- `BIT_COUNT` 函数对正整数和负整数的计算方式可能有所不同，因此在进行比较或聚合时需要特别注意。

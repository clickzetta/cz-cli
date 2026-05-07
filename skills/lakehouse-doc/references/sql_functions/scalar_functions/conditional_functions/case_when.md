### CASE 表达式

#### 1. 概述

CASE 表达式是 SQL 中的一种条件选择结构，它允许基于一系列条件返回不同的结果。CASE 表达式有两种形式：基于表达式的 CASE 和基于条件的 CASE。它们都可以用于在查询中实现分支逻辑。

#### 2. 基于表达式的 CASE

语法：

```sql
CASE expr {WHEN opt1 THEN res1} [...] [ELSE def] END
```

功能：

- 当表达式 `expr` 与某个 `optN` 相等时，返回对应的结果 `resN`。
- 如果 `expr` 与所有 `optN` 都不相等，则返回默认值 `def`。如果没有指定 `def`，则返回 `null`。

参数：

- `expr`：需要比较的任意类型表达式。
- `optN`：与 `expr` 类型相同的条件表达式，用于比较。
- `resN`：当条件匹配时返回的结果表达式。
- `def`：当没有匹配条件时的默认结果表达式。

示例：

```sql
SELECT
  CASE col
    WHEN 1 THEN 'a'
    WHEN 2 THEN 'b'
    ELSE 'c'
  END AS result
FROM VALUES(1), (2), (3) AS t(col);
```

结果：

```
result
a
b
c
```

#### 3. 基于条件的 CASE

语法：

```sql
CASE {WHEN cond1 THEN res1} [...] [ELSE def] END
```

功能：

- 当条件 `condN` 为 `true` 时，返回对应的结果 `resN`。
- 如果所有条件都不满足，则返回默认值 `def`。如果没有指定 `def`，则返回 `null`。

参数：

- `condN`：布尔表达式，用于判断分支是否满足条件。
- `resN`：当条件满足时返回的结果表达式。
- `def`：当没有满足条件时的默认结果表达式。

示例：

```sql
SELECT
  CASE
    WHEN col = 1 THEN 'a'
    WHEN col = 2 THEN 'b'
    ELSE 'c'
  END AS result
FROM VALUES(1), (2), (3), (4) AS t(col);
```

结果：

```
result
a
b
c
null
```

#### 4. 应用场景

- 数据转换：根据不同的条件对数据进行转换或映射。
- 分组统计：在分组统计时，根据某些条件对数据进行分类。
- 查询优化：在查询过程中，根据条件过滤或选择需要的数据。

#### 5. 注意事项

- 确保 `resN` 和 `def` 的数据类型一致。
- 在使用基于条件的 CASE 表达式时，确保所有条件互斥，避免产生歧义。
- 在实际应用中，根据具体需求选择合适的 CASE 表达式形式。
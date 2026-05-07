#### 简介

`multiIf` 函数是一种条件逻辑函数，它允许您在查询中更紧凑地编写类似 `CASE` 语句的逻辑。该函数按照指定的顺序评估多个条件，并返回第一个为真的条件对应的值。如果所有条件都不满足，则返回最后一个 `else` 表达式的值。

#### 语法

```Plain
multiIf(cond_1, then_1, cond_2, then_2, ..., else)
```

#### 参数

* `cond_N`：要评估的第 N 个条件。
* `then_N`：当第 N 个条件为真时返回的值。
* `else`：如果所有条件都不满足时返回的值。

#### 返回结果

* 返回任何一个 `then_N` 表达式的值，如果所有条件都不满足，则返回 `else` 表达式的值。

#### 使用示例

```SQL

SELECT    name,
          score,
          multiIf (
          score >= 90,
          'A',
          score >= 80,
          'B',
          score >= 70,
          'C',
          score >= 60,
          'D'        
          ) AS grade
FROM     
VALUES    ('Alice', 92),('Bob', 85),('Charlie', 77),('David', 63),('Eve', 58) students (name, score);
+---------+-------+-------+
|  name   | score | grade |
+---------+-------+-------+
| Alice   | 92    | A     |
| Bob     | 85    | B     |
| Charlie | 77    | C     |
| David   | 63    | D     |
| Eve     | 58    |       |
+---------+-------+-------+
```

#### 注意事项

* 如果 `multiIf` 函数中不包含 `else` 部分，当所有条件都不满足时，函数将返回 `NULL`。



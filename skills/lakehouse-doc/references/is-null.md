## IS NULL

`IS NULL` 子句用于在 `WHERE` 条件中判断列中的值是否为 `NULL`。`NULL` 表示该列没有值，或者值未知。需要注意的是，`NULL` 与空字符串或空格不同，后者是有具体值的。

## 注意事项

使用等号（`=`）来判断 `NULL` 是无法得到预期结果的，因为 `NULL` 不能用等号来比较。

## 语法

```sql
SELECT * FROM table_name WHERE expression IS NULL;
SELECT * FROM table_name WHERE expression IS NOT NULL;
```

其中，`expression` 是要判断的表达式，它可以是任意类型。`IS NULL` 和 `IS NOT NULL` 的返回值是布尔类型（`BOOLEAN`），如果 `expression` 的值为 `NULL`，则返回 `TRUE`，否则返回 `FALSE`。

## 示例

假设我们有一个名为 `student` 的表，其中包含以下数据：

| id | name  | gender |
|----|-------|--------|
| 1  | Alice | F      |
| 2  | Bob   | M      |
| 3  | Cathy | F      |
| 4  | David | NULL   |

1. 现在，我们想要从 `student` 表中查询性别为 `NULL` 的学生，我们可以使用以下 SQL 语句：

   ```sql
   SELECT * FROM student WHERE gender IS NULL;
   ```

   结果集如下：

   | id | name  | gender |
   |---|-------|--------|
   | 4  | David | NULL   |

2. 如果我们想要查询性别不为 `NULL` 的学生，我们可以使用以下 SQL 语句：

   ```sql
   SELECT * FROM student WHERE gender IS NOT NULL;
   ```

   结果集如下：

   | id | name  | gender |
   |---|-------|--------|
   | 1  | Alice | F      |
   | 2  | Bob   | M      |
   | 3  | Cathy | F      |

## 常见问题

Q: 为什么使用等号（`=`）判断 `NULL` 值无法得到预期结果？

A: 这是因为 `NULL` 表示未知或缺失的值，所以它不能与任何值（包括 `NULL`）进行比较。使用等号（`=`）判断 `NULL` 值时，结果会是 `UNKNOWN`，而不是 `TRUE` 或 `FALSE`。因此，我们需要使用 `IS NULL` 或 `IS NOT NULL` 来判断 `NULL` 值。
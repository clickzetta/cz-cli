# like运算符使用指南

LIKE 运算符是一种在 SQL 查询语句中用于字符串匹配的工具，它可以帮助您判断一个字符串是否符合特定的模式。LIKE 运算符在进行匹配时是**区分大小写**的，这意味着 'A' 和 'a' 会被视为不同的字符。

## 语法

LIKE 运算符的基本语法如下：

```SQL
str [ NOT ] LIKE pattern
```

其中，`str` 是要匹配的字符串表达式，`pattern` 是要匹配的模式表达式。您还可以使用 `NOT` 关键字来反转匹配条件。

此外，LIKE 运算符还支持与 `ANY`、`SOME` 或 `ALL` 关键字结合使用，以便在多个模式中进行匹配。当使用 `ALL` 时，`str` 必须匹配所有给定的模式；而使用 `ANY` 或 `SOME` 时，`str` 只需匹配至少一个模式。

### 模式中的通配符

LIKE 运算符的模式中包含以下两种特殊字符，用于表示通配匹配：

* `_`：匹配任意单个字符（类似于 POSIX 正则表达式中的 `.`）。
* `%`：匹配任意数量的字符（类似于 POSIX 正则表达式中的 `.*`）。

## 使用示例

假设我们有一个名为 `students` 的表，其中包含学生的姓名和班级信息，如下所示：

```SQL
CREATE TABLE students (
  name STRING,
  class STRING
);

INSERT INTO students (name, class) VALUES
  ('Alice', 'A'),
  ('Bob', 'B'),
  ('Carol', 'A'),
  ('David', 'C');
```

以下是一些使用 LIKE 运算符的查询示例，以及它们的输出结果：

1.  查询班级中包含字母 "A" 的学生（区分大小写）：

```SQL
SELECT name, class
FROM students
WHERE class LIKE '%A%';

+-------+-------+
| name  | class |
+-------+-------+
| Alice | A     |
| Carol | A     |
+-------+-------+
```

2.  查询姓名以 "A" 开头的学生（区分大小写）：

```SQL
SELECT name, class
FROM students
WHERE name LIKE 'A%';

+-------+-------+
| name  | class |
+-------+-------+
| Alice | A     |
+-------+-------+
```

3.  查询姓名以 "B" 或 "C" 开头的学生：

```SQL
SELECT name, class
FROM students
WHERE name LIKE ANY ('B%', 'C%');

+-------+-------+
| name  | class |
+-------+-------+
| Bob   | B     |
| Carol | A     |
+-------+-------+
```

4.  查询姓名中同时包含字母 "a" 和 "l" 的学生：

```SQL
SELECT name, class
FROM students
WHERE name LIKE ALL ('%a%', '%l%');

+-------+-------+
| name  | class |
+-------+-------+
| Carol | A     |
+-------+-------+
```

5.  查询姓名不以 "D" 开头的学生：

```SQL
SELECT name, class
FROM students
WHERE name NOT LIKE 'D%';

+-------+-------+
| name  | class |
+-------+-------+
| Alice | A     |
| Bob   | B     |
| Carol | A     |
+-------+-------+
```

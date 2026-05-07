## LATERAL VIEW

`LATERAL VIEW` 子句与生成器函数（如 EXPLODE、POSEXPLODE 等）结合使用，可以生成一个或多个包含行的虚拟表。该子句允许用户对输入的数组或映射进行操作，并将结果展开为独立的行。

## 语法格式

```
SELECT ...
FROM table_reference 
LATERAL VIEW [OUTER] generator_function [ alias ] AS column_identifier [, ...]
```

## 参数说明

* **OUTER**：可选参数。如果指定了 `OUTER` 关键字，当输入数组或映射为空或为 Null 时，将返回 Null 值。
* **generator\_function**：生成器函数，如 EXPLODE、POSEXPLODE 等。
* **alias**：可选参数。为 generator\_function 指定的别名。
* **column\_identifier**：列出列别名，用于 `generator_function` 输出的行。列标识符的数量必须与生成器函数返回的列数相匹配。

## 使用示例

**准备数据**

```
CREATE TABLE employees(id int,name string,skills array<string>);
INSERT INTO employees (id, name, skills) VALUES
(1, 'John Doe', ['Java', 'Python', 'SQL']),
(2, 'Jane Smith', ['C++', 'Hadoop', 'SQL']),
(3, 'Bob Johnson', ['Python', 'Docker']);
```

**示例 1：使用 EXPLODE 函数**
假设我们有一个名为 `employees` 的表，其中包含一个名为 `skills` 的数组类型的字段，我们想要将每个员工的技能拆分成单独的行。

```
SELECT e.id, e.name, s.skill
FROM employees e
LATERAL VIEW EXPLODE(e.skills) s AS skill;
+----+-------------+--------+
| id |    name     | skill  |
+----+-------------+--------+
| 1  | John Doe    | Java   |
| 1  | John Doe    | Python |
| 1  | John Doe    | SQL    |
| 2  | Jane Smith  | C++    |
| 2  | Jane Smith  | Hadoop |
| 2  | Jane Smith  | SQL    |
| 3  | Bob Johnson | Python |
| 3  | Bob Johnson | Docker |
+----+-------------+--------+
```

**示例 2：使用 POSEXPLODE 函数**
`POSEXPLODE` 函数与 `EXPLODE` 类似，但它还会返回数组中元素的位置索引。使用相同的 `employees` 表和插入的数据，我们可以使用 `POSEXPLODE`：

```
SELECT e.id, e.name, ps.position, ps.skill
FROM employees e
LATERAL VIEW POSEXPLODE(e.skills) ps AS position, skill;
+----+-------------+----------+--------+
| id |    name     | position | skill  |
+----+-------------+----------+--------+
| 1  | John Doe    | 0        | Java   |
| 1  | John Doe    | 1        | Python |
| 1  | John Doe    | 2        | SQL    |
| 2  | Jane Smith  | 0        | C++    |
| 2  | Jane Smith  | 1        | Hadoop |
| 2  | Jane Smith  | 2        | SQL    |
| 3  | Bob Johnson | 0        | Python |
| 3  | Bob Johnson | 1        | Docker |
+----+-------------+----------+--------+

```

## 注意事项

* 使用 `LATERAL VIEW` 子句时，请确保已正确指定生成器函数、别名和列标识符。


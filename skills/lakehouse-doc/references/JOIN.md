# JOIN

Join 是指在 SQL 语句中使用 JOIN 子句将两个或多个表的数据根据某些条件进行合并的操作。它可以让您从不同的数据源中获取相关信息，并且可以在合并之前或之后对数据进行一些转换或处理。Join 的语法如下：

```SQL
left_table_reference { 
[ join_type ] JOIN right_table_reference join_criteria |
 NATURAL  JOIN right_table_reference | 
 CROSS JOIN right_table_reference } 
 --join类型
join_type::= 
     { [ INNER ] | LEFT [ OUTER ] | [ LEFT ] SEMI | RIGHT [ OUTER ] | FULL [ OUTER ] | [ LEFT ] ANTI | CROSS } 
--join条件
join_criteria::=
     { ON boolean_expression | USING ( column_name [, ...] ) }
```

其中，`left_table_reference` 是指 JOIN 的左表，`right_table_reference` 是指 JOIN 的右表，`join_type` 是指 JOIN 的类型，`join_criteria` 是指 JOIN 的条件。

## Join的类型

Join 的类型有以下几种：

* **INNER JOIN**：返回两个表中满足 JOIN 条件的数据行，也就是两个表的交集。这是默认的 JOIN 类型。
* **LEFT \[OUTER] JOIN**：返回左表的所有数据行，以及右表中满足 JOIN 条件的数据行，如果右表中没有匹配的数据行，则用 NULL 填充。这也叫做左外连接。
* **RIGHT \[OUTER] JOIN**：返回右表的所有数据行，以及左表中满足 JOIN 条件的数据行，如果左表中没有匹配的数据行，则用 NULL 填充。这也叫做右外连接。
* **FULL \[OUTER] JOIN**：返回两个表的所有数据行，如果某个表中没有匹配的数据行，则用 NULL 填充。这也叫做全外连接。
* \[**LEFT] SEMI JOIN**：返回左表中满足 JOIN 条件的数据行，不返回右表的数据。这也叫做左半连接。
* \[**LEFT] ANTI JOIN**：返回左表中不满足 JOIN 条件的数据行，不返回右表的数据。这也叫做左反连接。
* **CROSS JOIN**：返回两个表的笛卡尔积，也就是两个表所有可能的组合。
* **NATURAL JOIN**：根据两个表中同名的列进行隐式的等值连接，不需要指定 JOIN 条件。

## Join的条件

Join 的条件有以下两种：

* **ON boolean_expression**：指定一个返回布尔值的表达式，用来判断两个表的数据行是否匹配。如果结果为真，则认为匹配。JOIN 条件不支持子查询。
* **USING (column_name** [, …])：指定一个或多个列名，用来进行等值连接。这些列名必须同时存在于两个表中。JOIN 条件不支持子查询。

## Join 的使用示例

以下是一些使用 JOIN 的 SQL 语句的示例，以及它们的输出结果。假设我们有以下两个表：

```SQL
create table students(name string,class string);
INSERT INTO students (name, class) VALUES
('Alice', 'A'),
('Bob', 'B'),
('Carol', 'A'),
('David', 'C');
create table scores(name string,score int);
INSERT INTO scores (name, score) VALUES
('Alice', 90),
('Bob', 80),
('Carol', 85),
('David', 95);
```

### INNER JOIN

* 查询：使用 INNER JOIN 将两个表的数据合并，根据姓名进行匹配，显示每个学生的姓名、班级和成绩。

```SQL
SELECT students.name, students.class, scores.score
FROM students
INNER JOIN scores
ON students.name = scores.name;

+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Carol | A     | 85    |
| Bob   | B     | 80    |
| David | C     | 95    |
| Alice | A     | 90    |
+-------+-------+-------+
```

### LEFT \[OUTER] JOIN

* 查询：使用 LEFT JOIN 将两个表的数据合并，根据姓名进行匹配，显示每个学生的姓名、班级和成绩，如果某个学生没有成绩，则用 NULL 填充。

```SQL
SELECT students.name, students.class, scores.score
FROM students
LEFT JOIN scores
ON students.name = scores.name;
+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Carol | A     | 85    |
| Bob   | B     | 80    |
| David | C     | 95    |
| Alice | A     | 90    |
+-------+-------+-------+
```

### RIGHT \[OUTER] JOIN

* 查询：使用 RIGHT JOIN 将两个表的数据合并，根据姓名进行匹配，显示每个学生的姓名、班级和成绩，如果某个学生没有班级，则用 NULL 填充。

```SQL
SELECT students.name, students.class, scores.score
FROM students
RIGHT JOIN scores
ON students.name = scores.name;

+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Carol | A     | 85    |
| Bob   | B     | 80    |
| David | C     | 95    |
| Alice | A     | 90    |
+-------+-------+-------+
```

### FULL \[OUTER] JOIN

* 查询：使用 FULL JOIN 将两个表的数据合并，根据姓名进行匹配，显示每个学生的姓名、班级和成绩，如果某个学生没有班级或成绩，则用 NULL 填充。

```SQL
SELECT students.name, students.class, scores.score
FROM students
FULL JOIN scores
ON students.name = scores.name;


+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Carol | A     | 85    |
| Bob   | B     | 80    |
| David | C     | 95    |
| Alice | A     | 90    |
+-------+-------+-------+
```

### \[LEFT] SEMI JOIN

* 查询：使用 SEMI JOIN 将两个表的数据合并，根据姓名进行匹配，只显示有成绩的学生的姓名和班级。

```SQL
SELECT students.name, students.class
FROM students
SEMI JOIN scores
ON students.name = scores.name;
+-------+-------+
| name  | class |
+-------+-------+
| Carol | A     |
| Bob   | B     |
| David | C     |
| Alice | A     |
+-------+-------+
```

### \[LEFT] ANTI JOIN

* 查询：使用 ANTI JOIN 将两个表的数据合并，根据姓名进行匹配，只显示没有成绩的学生的姓名和班级。

```SQL
SELECT students.name, students.class
FROM students
ANTI JOIN scores
ON students.name = scores.name;

+------+-------+
| name | class |
+------+-------+
```

### CROSS JOIN

* 查询：使用 CROSS JOIN 将两个表的数据合并，显示每个学生的姓名、班级和成绩的所有可能的组合。

```SQL
SELECT students.name, students.class, scores.score
FROM students
CROSS JOIN scores;

+-------+-------+-------+
| name  | class | score |
+-------+-------+-------+
| Alice | A     | 90    |
| Bob   | B     | 90    |
| Carol | A     | 90    |
| David | C     | 90    |
| Alice | A     | 80    |
| Bob   | B     | 80    |
| Carol | A     | 80    |
| David | C     | 80    |
| Alice | A     | 85    |
| Bob   | B     | 85    |
| Carol | A     | 85    |
| David | C     | 85    |
| Alice | A     | 95    |
| Bob   | B     | 95    |
| Carol | A     | 95    |
| David | C     | 95    |
+-------+-------+-------+
```



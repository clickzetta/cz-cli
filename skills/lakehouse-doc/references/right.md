## RIGHT 函数：从字符串右侧提取指定长度的字符

RIGHT 函数用于从给定字符串的右侧开始提取指定数量的字符。这个函数在处理文本数据时非常有用，尤其是在需要根据特定规则截取字符串的场景下。

### 函数语法

```sql
RIGHT(string, length)
```

- `string`：要提取字符的原始字符串。
- `length`：要提取的字符数量，必须是一个大于或等于零的整数。

### 函数行为说明

- 如果 `length` 等于 0，函数返回一个空字符串。
- 如果 `length` 大于 `string` 的长度，函数返回 `string` 本身。
- 如果 `length` 小于 0，函数返回 NULL。
- 如果 `string` 为 NULL，函数返回 NULL。

### 实际应用案例

**案例 1：提取学生姓名的后两个字符**

假设有一个名为 `student` 的表，其中包含学生的姓名（name）和性别（gender），如下所示：

| id | name  | gender |
|----|-------|--------|
| 1  | Alice | F      |
| 2  | Bob   | M      |
| 3  | Cathy | F      |
| 4  | David | M      |

现在，我们想要查询每个学生姓名的后两个字符，可以使用以下 SQL 语句：

```sql
SELECT name, RIGHT(name, 2) AS suffix FROM student;
```

查询结果如下：

| name  | suffix |
|-------|--------|
| Alice | ce     |
| Bob   | ob     |
| Cathy | hy     |
| David | id     |

**案例 2：提取文件名的扩展名**

假设我们有一个包含文件名的字符串，现在需要提取其扩展名（即文件名中最后一个点号之后的部分）。例如，字符串 `"report.xls"` 的扩展名是 `"xls"`。

```sql
SELECT RIGHT('report.xls', 4) AS file_extension;
```

查询结果为：

| file_extension |
|----------------|
| xls            |

**案例 3：处理长度不足的情况**

假设我们需要提取字符串末尾的若干字符，但字符串本身的长度可能小于要提取的字符数。例如，处理以下字符串：

- `"这是一个示例文本"`（长度为 9）
- `"示例"`（长度为 2）

使用 RIGHT 函数提取最后 3 个字符：

```sql
SELECT RIGHT('这是一个示例文本', 3) AS last_three_chars;
SELECT RIGHT('示例', 3) AS last_three_chars;
```

结果如下：

| last_three_chars |
|------------------|
| 例文本           |
| 示例             |



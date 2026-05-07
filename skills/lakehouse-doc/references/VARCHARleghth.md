# VARCHAR(n)

变长字符类型（VARCHAR）是一种可存储可变长度的字符串数据类型。该类型在存储字符串时会根据实际内容的长度进行分配空间，从而有效节省存储空间。VARCHAR 类型的字符串长度范围为 1 到 65535 个字符。

## 语法

```
VARCHAR(n)
```

其中，n 表示字符串的最大长度，取值范围为 1 到 1048576。

## 示例

1. 创建一个 VARCHAR 类型的表：

   ```
   CREATE TABLE example_table (
       id INT PRIMARY KEY,
       name VARCHAR(50),
       age INT
   );
   ```

   在这个例子中，我们创建了一个名为 example_table 的表，其中包含三个字段：id（整数类型，主键）、name（变长字符类型，最大长度为 50 个字符）和 age（整数类型）。

2. 向 VARCHAR 类型的字段插入数据：

   ```
   INSERT INTO example_table (id, name, age) VALUES (1, '张三', 25);
   ```

   在这个例子中，我们向 example_table 表中插入了一条数据，其中 name 字段的值为 '张三'，长度为 3 个字符。

3. 查询 VARCHAR 类型字段的数据：

   ```
   SELECT name FROM example_table;
   ```

   在这个例子中，我们查询了 example_table 表中 name 字段的数据。


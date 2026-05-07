# SMALLINT

16位有符号整型（SMALLINT）是一种整数数据类型，用于存储范围在 -32,768 到 32,767 之间的整数值。这种数据类型占用两个字节（16位）的存储空间，适用于存储较小的整数值，以节省存储空间。

## 语法
```
SMALLINT
```

## 示例
1. 创建一个包含SMALLINT类型列的表：

   ```sql
   CREATE TABLE example_table (
       id INT,
       name VARCHAR(50),
       smallint_value SMALLINT
   );
   ```

2. 向表中插入SMALLINT类型的数据：

   ```sql
   INSERT INTO example_table (id, name, smallint_value)
   VALUES (1, '张三', -32768);
   ```

3. 查询表中的SMALLINT类型数据：

   ```sql
   SELECT * FROM example_table;
   ```

4. 使用SMALLINT类型数据进行条件筛选：

   ```sql
   SELECT * FROM example_table WHERE smallint_value > 0;
   ```

5. 对SMALLINT类型的数据进行数学运算：

   ```sql
   SELECT smallint_value + 1 FROM example_table;
   ```

## 注意事项
- 请确保插入的数据在SMALLINT类型的有效范围内，否则可能导致数据溢出或截断。
- 在进行数学运算时，请注意数据类型之间的隐式转换，以避免意外的结果。
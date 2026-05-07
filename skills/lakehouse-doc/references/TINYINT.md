# TINYINT

`TINYINT` 是一种 8 位有符号整型数据类型，用于存储范围在 -128 到 127 之间的整数值。它可以有效地节省存储空间，因为它仅使用一个字节来表示数值。

## 语法

```
TINYINT
```


## 示例

1. 创建一个包含 `TINYINT` 类型列的表：

   ```sql
   CREATE TABLE example_table (
       id TINYINT
   );
   ```

2. 向 `TINYINT` 类型的列插入数据：

   ```sql
   INSERT INTO example_table (id) VALUES (-100);
   INSERT INTO example_table (id) VALUES (100);
   ```

3. 查询 `TINYINT` 类型列的数据：

   ```sql
   SELECT id FROM example_table;
   ```

4. 使用 `TINYINT` 类型列进行条件查询：

   ```sql
   SELECT id FROM example_table WHERE id > -50;
   ```

5. 创建一个包含 `TINYINT` 类型列（指定最大显示宽度）的表：

   ```sql
   CREATE TABLE example_table2 (
       age TINYINT
   );
   ```

6. 向 `TINYINT` 类型列（指定最大显示宽度）插入数据：

   ```sql
   INSERT INTO example_table2 (age) VALUES (25y);
   ```
7.  `TINYINT`  常量格式：

   ```sql
    SELECT 11y
   ```
## 注意事项

- `TINYINT` 类型仅适用于存储较小的整数值。对于较大的数值，建议使用 `INT` 或 `BIGINT` 类型。
- 当使用 `TINYINT` 类型存储负数时，数值范围为 -128 到 -1。若尝试插入超出此范围的负数，将导致溢出错误。
- 当使用 `TINYINT` 类型存储正数时，数值范围为 1 到 127。若尝试插入超出此范围的正数，将导致溢出错误。
### BIT_XOR 函数

```sql
bit_xor([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`BIT_XOR` 函数用于计算一组整数数据的按位异或（`bitwise XOR`）结果。按位异或操作是指对两个二进制数的对应位进行比较，如果两个比特位相同，则结果为 0；如果不同，则结果为 1。

#### 参数说明

* `expr`：整数类型表达式，可以是 `TINYINT`、`SMALLINT`、`INT` 或 `BIGINT` 类型。
* `DISTINCT`（可选）：当使用 `DISTINCT` 关键字时，函数将计算去重后的集合的按位异或结果。

#### 返回结果

* 返回值类型与参数类型一致。
* 如果参数中包含 `NULL` 值，则该值不参与计算。

#### 使用示例

1. 计算一组整数的按位异或结果：

```sql
SELECT bit_xor(col) FROM VALUES (3), (5), (7) AS tab(col);
+--------------+
| bit_xor(col) |
+--------------+
| 1            |
+--------------+
```

2. 计算去重后的整数集合的按位异或结果：

```sql
SELECT bit_xor(DISTINCT col) FROM VALUES (3), (3), (5), (7), (NULL) AS tab(col);
+-----------------------+
| bit_xor(DISTINCT col) |
+-----------------------+
| 1                     |
+-----------------------+
```

3. 在实际数据表中计算按位异或结果：

```sql
CREATE TABLE example_table (id INT);
INSERT INTO example_table VALUES (3), (5), (7);
SELECT bit_xor(id) FROM example_table;
+-------------+
| bit_xor(id) |
+-------------+
| 1           |
+-------------+
```

4. 计算包含 `NULL` 值的整数集合的按位异或结果：

```sql
INSERT INTO example_table VALUES (NULL), (8);
SELECT bit_xor(id) FROM example_table;
+-------------+
| bit_xor(id) |
+-------------+
| 9           |
+-------------+
```

5. 使用 FILTER 子句条件性地计算按位异或：

```sql
SELECT bit_xor(col) FILTER (WHERE col > 3) FROM VALUES (3), (5), (7) AS tab(col);
+---------------------------------------+
| bit_xor(col) FILTER (WHERE (col > 3)) |
+---------------------------------------+
| 2                                     |
+---------------------------------------+
```

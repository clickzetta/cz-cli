### POSEXPLODE 函数

#### 概述

`posexplode` 函数用于将输入的数组或映射类型的表达式 `expr` 展开成多行数据,并为每行添加位置列,以指明元素在原始数组或映射中的相对位置。该函数可以直接使用,也可以与 `LATERAL VIEW` 配合使用,以便在更复杂的查询中实现数据展开。

#### 功能

1. 对于数组类型的输入,`posexplode` 会将数组中的每个元素展开成一行,并添加名为 `pos` 和 `col` 的列,分别表示元素的位置和值。
2. 对于映射类型的输入,`posexplode` 会将映射中的每个键值对展开成一行,并添加名为 `pos`、`key` 和 `value` 的列,分别表示元素的位置、键和值。

#### 参数

* `expr`: 输入的数组 `array<T>` 或映射 `map<K, V>` 类型。

#### 返回结果

* 对于数组类型的输入,返回类型为 `int, T`。
* 对于映射类型的输入,返回类型为 `int, K, V`。

#### 使用示例

1. 展开数组类型的输入：

   ```sql
   SELECT posexplode(array(1, 2, 3));
   +-----+-----+
   | pos | col |
   +-----+-----+
   | 0   | 1   |
   | 1   | 2   |
   | 2   | 3   |
   +-----+-----+
   ```

2. 展开映射类型的输入：

   ```sql
   SELECT posexplode(map("a", 1, "b", 2, "c", 3));
   +-----+-----+-------+
   | pos | key | value |
   +-----+-----+-------+
   | 0   | a   | 1     |
   | 1   | b   | 2     |
   | 2   | c   | 3     |
   +-----+-----+-------+
   ```

3. 结合 `LATERAL VIEW` 使用：

   ```sql
   SELECT word, pos, ex
   FROM VALUES ('hello') AS vt(word)
   LATERAL VIEW posexplode(array(5, 6)) lv AS pos, ex;
   +-------+-----+----+
   | word  | pos | ex |
   +-------+-----+----+
   | hello | 0   | 5  |
   | hello | 1   | 6  |
   +-------+-----+----+
   ```

4. 展开数组并筛选特定元素：

   ```sql
   SELECT pos, col
   FROM posexplode(array(1, 2, 3, 4)) AS t(pos, col)
   WHERE col % 2 = 0;
   +-----+-----+
   | pos | col |
   +-----+-----+
   | 1   | 2   |
   | 3   | 4   |
   +-----+-----+
   ```

5. 展开映射并计算值的总和：

   ```sql
   SELECT SUM(value) AS total_sum
   FROM posexplode(map("a", 1, "b", 2, "c", 3)) AS t(pos, key, value);
   +-----------+
   | total_sum |
   +-----------+
   | 6         |
   +-----------+
   ```

通过以上示例,您可以更好地理解 `posexplode` 函数的用法和功能。在实际应用中,您可以根据需要对数组或映射类型的数据进行展开和处理。

### EXPLODE 函数

#### 功能描述

`EXPLODE` 函数用于将数组或映射类型的表达式展开成多行。对于数组类型的输入，元素会被逐个展开成独立的行；对于映射类型的输入，键和值会被分别展开成多行。该函数可以直接使用，也可以与 `LATERAL VIEW` 搭配使用，以实现更复杂的数据处理。

#### 参数说明

* `expr`：输入的数组（`array<T>`）或映射（`map<K, V>`）表达式。

#### 返回结果

* 对于数组类型的输入，返回的结果中每个元素的类型为 `T`。
* 对于映射类型的输入，返回的结果中包含两个列，分别表示键（`key`）和值（`value`），它们的类型分别为 `K` 和 `V`。

#### 使用示例

1. 将数组类型的表达式展开成多行：

```sql
SELECT explode(array(1, 2, 3));
+-----+
| col |
+-----+
| 1   |
| 2   |
| 3   |
+-----+
```

2. 将映射类型的表达式展开成多行：

```sql
SELECT explode(map("a", 1, "b", 2, "c", 3));
+-----+-------+
| key | value |
+-----+-------+
| a   | 1     |
| b   | 2     |
| c   | 3     |
+-----+-------+
```

3. 结合 LATERAL VIEW 使用，将数组类型的表达式展开成多行，并与原始数据关联：

```sql
SELECT vt.word, lv.ex
FROM VALUES ('hello') AS vt(word) LATERAL VIEW explode(array(5, 6)) lv AS ex;
+-------+----+
| word  | ex |
+-------+----+
| hello | 5  |
| hello | 6  |
+-------+----+
```

4. 结合 LATERAL VIEW 使用，将映射类型的表达式展开成多行，并与原始数据关联：

```sql
SELECT vt.word, lv.key, lv.value
FROM VALUES ('hello') AS vt(word) LATERAL VIEW explode(map("a", 1, "b", 2, "c", 3)) lv AS key, value;
+-------+-----+-------+
| word  | key | value |
+-------+-----+-------+
| hello | a   | 1     |
| hello | b   | 2     |
| hello | c   | 3     |
+-------+-----+-------+
```

通过以上示例，您可以看到 `EXPLODE` 函数在处理数组和映射类型数据时的灵活性和实用性。在实际应用中，您可以根据需要对输入数据进行展开操作，以便进行更深入的数据分析和处理。

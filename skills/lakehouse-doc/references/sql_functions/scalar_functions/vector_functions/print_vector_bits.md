# PRINT\_VECTOR\_BITS

sql

```sql
PRINT_VECTOR_BITS(vector);
```

## 功能描述

将二值化的向量转换成可读的字符串表示，显示向量中每个字节的二进制位模式。这个函数主要用于调试和可视化二值化向量的内容，帮助理解BINARY\_QUANTIZE函数的输出结果。

## 参数说明

* `vector`: 二值化向量，类型为 `vector`\<tinyint>

## 返回结果

返回一个string类型的结果，以二进制位字符串的形式显示向量内容。

## 案例

* 显示二值化向量的位表示

```sql
SELECT PRINT_VECTOR_BITS(VECTOR(101y)) as bit_string;
+------------+
| bit_string |
+------------+
| 01100101   |
+------------+
```

* 显示多字节二值化向量的位表示

```sql
SELECT PRINT_VECTOR_BITS(VECTOR(15y, 24y)) as bit_string;
+------------------+
|    bit_string    |
+------------------+
| 0000111100011000 |
+------------------+
```

* 结合BINARY\_QUANTIZE使用

```sql
SELECT PRINT_VECTOR_BITS(BINARY_QUANTIZE(VECTOR(1.0f, -1.0f, 1.0f, -1.0f, 1.0f, -1.0f, 1.0f, -1.0f))) as bit_pattern;
+-------------+
| bit_pattern |
+-------------+
| 10101010    |
+-------------+
```



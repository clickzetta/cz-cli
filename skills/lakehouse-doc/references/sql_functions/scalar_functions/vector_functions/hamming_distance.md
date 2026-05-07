# HAMMING\_DISTANCE

```sql
HAMMING_DISTANCE(vector1, vector2);
```

## 功能描述

计算两个等长向量之间的[汉明距离（Hamming Distance）](https://en.wikipedia.org/wiki/Hamming_distance)。汉明距离指两个等长字符串对应位置的不同字符的个数，在向量计算中表示两个向量中对应元素不相等的位置数量。

## 参数说明

* `vector1`: 第一个向量，支持的类型 `vector\<tinyint>`
* `vector2`: 第二个向量，支持的类型 `vector\<tinyint>`

注意：两个向量必须具有相同的长度。

## 返回结果

返回一个bigint类型的结果，表示两个向量中不相等元素的个数。

## 案例

* 计算 `vector\<tinyint>` 类型的两个向量之间的汉明距离

```sql
SELECT HAMMING_DISTANCE(VECTOR(1y, 0y, 1y), VECTOR(1y, 1y, 0y)) as hamming_dis;
+-------------+
| hamming_dis |
+-------------+
| 2.0         |
+-------------+
```

* 计算更长的 `tinyint` 向量之间的汉明距离

```sql
SELECT HAMMING_DISTANCE(VECTOR(1y, 0y, 1y, 0y), VECTOR(1y, 0y, 0y, 1y)) as hamming_dis;
+-------------+
| hamming_dis |
+-------------+
| 2.0         |
+-------------+
```

* 计算相同向量的汉明距离（结果为 0）

```sql
SELECT HAMMING_DISTANCE(VECTOR(1y, 1y, 0y), VECTOR(1y, 1y, 0y)) as hamming_dis;
+-------------+
| hamming_dis |
+-------------+
| 0.0         |
+-------------+
```



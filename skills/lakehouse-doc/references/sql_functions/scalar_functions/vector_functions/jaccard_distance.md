# JACCARD\_DISTANCE

```sql
JACCARD_DISTANCE(vector1, vector2);
```

## 功能描述

计算两个向量之间的[雅卡德距离（Jaccard Distance）](https://en.wikipedia.org/wiki/Jaccard_index)。雅卡德距离定义为 1 - 雅卡德相似系数，用于衡量两个集合的差异程度。对于二进制向量，Jaccard 距离 = 1 - |A∩B| / |A∪B|，其中 A 和 B 分别表示两个向量中非零元素的集合。

## 参数说明

* `vector1`：第一个向量，支持的类型 `vector`\<tinyint>
* `vector2`：第二个向量，支持的类型 `vector`\<tinyint>

## 返回结果

返回一个 `double` 类型的结果，取值范围为 [0, 1]。其中 0 表示两个向量完全相同，1 表示完全不同。

## 案例

* 计算 `vector`\<tinyint> 类型的两个向量之间的 Jaccard 距离

```sql
SELECT JACCARD_DISTANCE(VECTOR(1y, 0y, 1y), VECTOR(1y, 1y, 0y)) as jaccard_dis;
+-------------+
| jaccard_dis |
+-------------+
| 0.6666666   |
+-------------+
```

* 计算更长的 `tinyint` 向量之间的 Jaccard 距离

```sql
SELECT JACCARD_DISTANCE(VECTOR(1y, 0y, 1y, 0y), VECTOR(1y, 0y, 0y, 1y)) as jaccard_dis;
+-------------+
| jaccard_dis |
+-------------+
| 0.6666666   |
+-------------+
```

* 计算相同向量的 Jaccard 距离（结果为 0）

```sql
SELECT JACCARD_DISTANCE(VECTOR(1y, 1y, 0y), VECTOR(1y, 1y, 0y)) as jaccard_dis;
+-------------+
| jaccard_dis |
+-------------+
| 0.0         |
+-------------+
```

^

## L2\_DISTANCE

```SQL
 L2_DISTANCE(vector1, vector2);
```

### 功能描述

计算欧几里得空间中两点（向量的值即坐标）之间的距离（[欧几里得距离](https://en.wikipedia.org/wiki/Euclidean_distance)）。

### 参数说明

* vector1:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>
* vector2:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>

### 返回结果

返回一个 double 类型的结果。

### 案例

* 计算array\<decimal>类型的两个向量之间的距离

```SQL
SELECT L2_distance(array(1bd, 2bd), array(2bd, 3bd)) as l2dis;
+--------------------+
|       l2dis        |
+--------------------+
| 1.4142135623730951 |
+--------------------+
```

* 计算array\<double>类型的两个向量之间的距离

```SQL
SELECT L2_distance(array(1d, 2d), array(2d, 3d)) as l2dis;
+--------------------+
|       l2dis        |
+--------------------+
| 1.4142135623730951 |
+--------------------+
```

* 计算array\<float>类型的两个向量之间的距离

```SQL
SELECT L2_distance(array(1f, 2f), array(2f, 3f)) as l2dis;
+--------------------+
|       l2dis        |
+--------------------+
| 1.4142135623730951 |
+--------------------+
```

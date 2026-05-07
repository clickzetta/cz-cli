## COSINE\_DISTANCE

```SQL
 COSINE_DISTANCE(vector1, vector2);
```

### 功能描述

cosine\_distance，即余弦距离，是一种衡量两个向量方向差异的度量方法。它是从1减去余弦相似度得到的，用于反映向量在方向上的不同程度。余弦相似度本身是通过计算两个向量的夹角余弦值来确定的，其值范围在-1到1之间。

### 参数说明

* vector1:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>
* vector2:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>

### 返回结果

返回一个 double 类型的结果。

### 案例

* 计算array\<decimal>类型的两个向量之间的距离

```SQL
SELECT cosine_distance(array(1bd, 2bd), array(2bd, 3bd)) as cosDis;
+----------------------+
|        cosDis        |
+----------------------+
| 0.007722123286332261 |
+----------------------+
```

* 计算array\<double>类型的两个向量之间的距离

```SQL
SELECT cosine_distance(array(1d, 2d), array(2d, 3d)) as cosDis;
+----------------------+
|        cosDis        |
+----------------------+
| 0.007722123286332261 |
+----------------------+
```

* 计算array\<float>类型的两个向量之间的距离

```SQL
SELECT cosine_distance(array(1f, 2f), array(2f, 3f)) as cosDis;
+----------------------+
|        cosDis        |
+----------------------+
| 0.007722123286332261 |
+----------------------+
```

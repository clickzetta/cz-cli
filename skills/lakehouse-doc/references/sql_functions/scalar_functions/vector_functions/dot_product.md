## DOT\_PRODUCT

```SQL
 DOT_PRODUCT(vector1, vector2);
```

### 功能描述

点积（也称为数量积或标量积），是一种基本的代数运算，它接受两个等长的数字序列（通常是坐标向量）并返回一个单一的数字。

### 参数说明

* vector1:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>
* vector2:第一个向量，支持的类型array\<decimal>、array\<double>、array\<float>

### 返回结果

返回一个 double 类型的结果。

### 案例

* 计算array\<decimal>类型的两个向量之间的点积

```SQL
SELECT dot_product(array(1bd, 2bd, 3bd), array(4bd, 5bd, 6bd)) AS res;

+------+
| res  |
+------+
| 32.0 |
+------+
```

* 计算array\<double>类型的两个向量之间的点积

```SQL
SELECT dot_product(array(1d, 2d, 3d), array(4d, 5d, 6d)) AS res;
+------+
| res  |
+------+
| 32.0 |
+------+
```

* 计算array\<float>类型的两个向量之间的点积

```SQL
SELECT dot_product(array(1f, 2f, 3f), array(4f, 5f, 6f)) AS res;
+------+
| res  |
+------+
| 32.0 |
+------+
```

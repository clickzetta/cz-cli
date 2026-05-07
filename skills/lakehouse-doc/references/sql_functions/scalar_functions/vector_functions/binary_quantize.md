# BINARY\_QUANTIZE



```sql
BINARY_QUANTIZE(vec);
```

## 功能描述

将输入向量进行二值化处理，将每个浮点数元素转换为二进制表示。通常用于向量压缩和快速相似度计算，其中每一个比特（bit）表示原向量中对应元素的二值化结果（通常以 0 为阈值，大于等于 0 为 1，小于 0 为 0）。

## 参数说明

* `vec`: 输入向量，支持的类型为 `vector<<float>>`、`vector<<double>>` 等数值向量类型。

## 返回结果

返回一个 `vector<<tinyint>>` 类型的向量，其中每个 `tinyint` 元素（通常为 8 位）打包存储了原向量中多个元素的二值化结果。

## 案例

* 对浮点向量进行二值化
  ```sql
SELECT BINARY_QUANTIZE(VECTOR(1.5f, -0.5f, 2.0f, -1.0f, 0.5f, -2.0f, 1.0f, 0.0f)) as binary_vec;
+------------+
| binary_vec |
+------------+
| [-86]      |
+------------+
```
* 对全正数向量进行二值化
  ```sql
SELECT BINARY_QUANTIZE(VECTOR(1.0f, 2.0f, 3.0f, 4.0f)) as binary_vec;
+------------+
| binary_vec |
+------------+
| [-16]      |
+------------+
```
* 对全负数向量进行二值化
  ```sql
SELECT BINARY_QUANTIZE(VECTOR(-1.0f, -2.0f, -3.0f, -4.0f)) as binary_vec;
+------------+
| binary_vec |
+------------+
| [0]        |
+------------+
```



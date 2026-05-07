# VECTOR\_ADD\_SCALAR

sql

```sql
VECTOR_ADD_SCALAR(vec, scalar);
```

## 功能描述

对向量中的每个元素都加上指定的标量值。这是一个向量与标量的广播加法运算，将标量值添加到向量的每个分量上。

## 参数说明

* `vec`: 输入向量，支持的类型包括 `vector\<float>`、`vector\<double>` 等数值向量类型。
* `scalar`: 要加到每个元素上的标量值，其类型必须为 `integer`。

## 返回结果

返回一个与输入向量相同类型的向量，其中每个元素都是原向量对应元素加上标量值的结果。

## 示例

* 对浮点向量的每个元素加上整数标量值

```sql
SELECT VECTOR_ADD_SCALAR(VECTOR(1.0f, 2.0f, 3.0f), 5) as result_vec;
+------------+
| result_vec |
+------------+
| [6,7,8]    |
+------------+
```

* 对向量的每个元素加上负整数标量

```sql
SELECT VECTOR_ADD_SCALAR(VECTOR(10.0f, 20.0f, 30.0f), -5) as result_vec;
+------------+
| result_vec |
+------------+
| [5,15,25]  |
+------------+
```

* 向量元素加上零（返回原向量）

```sql
SELECT VECTOR_ADD_SCALAR(VECTOR(1.5f, 2.5f, 3.5f), 0) as result_vec;
+---------------+
|  result_vec   |
+---------------+
| [1.5,2.5,3.5] |
+---------------+
```



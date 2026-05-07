###  VECTOR
``` sql
vector(value1, value2, ...)
```

#### 功能
创建一个向量类型的值。向量是一种特殊的数组类型，专门用于向量计算和相似度搜索。

#### 参数
* value1, value2, ...: 数值类型的值，可以是 tinyint, smallint, int, bigint, float, double 或 decimal

#### 返回结果
* vector 类型，返回包含所有参数值的向量
* 向量的元素类型根据输入参数自动推断
* 向量的维度等于参数个数

#### 举例
```sql
> SELECT vector(1, 2, 3);
[1,2,3]

> SELECT typeof(vector(1Y, 2Y, 3Y));
vector(tinyint,3)

> SELECT typeof(vector(1, 2, 3));
vector(int,3)

> SELECT typeof(vector(1.0F, 2.0F, 3.0F));
vector(float,3)

> SELECT typeof(vector(1.0, 2.0, 3.0));
vector(float,3)

> SELECT size(vector(1, 2, 3));
3
```

#### 举例
```sql
-- 创建不同类型的向量
> SELECT vector(1Y, 2Y, 3Y);
[1,2,3]

> SELECT vector(1.0, 2.0, 3.0, 4.0);
[1,2,3,4]

-- 向量可以参与比较
> SELECT vector(1, 2, 3) == vector(1, 2, 3);
true

> SELECT vector(1, 2, 3) == vector(2, 3, 4);
false

-- 向量可以作为数组使用
> SELECT array_distinct(vector(1, 2, 1));
[1,2]

-- 向量可以排序
> SELECT v FROM VALUES (vector(2, 3, 4)), (vector(1, 2, 3)) AS t(v) ORDER BY v;
[1,2,3]
[2,3,4]
```

#### 说明
* vector 类型是 array 类型的特殊形式，专门优化用于向量计算
* 支持的元素类型：tinyint (i8), smallint (i16), int (i32), bigint (i64), float, double
* 向量可以与 array 类型互相转换和混合使用
* 向量支持相等比较、排序等基本操作
* 向量常用于向量相似度搜索、机器学习和推荐系统
* 可以使用 `size()` 函数获取向量的维度

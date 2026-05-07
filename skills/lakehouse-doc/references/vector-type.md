# VECTOR
## 语法

```Plain
vector(scalar_type, dimension)
vector(dimension)
```

* scalar type 为向量中的元素类型，可选，默认值是float类型。支持tinyint/int/float
* dimension：仅指定维度

**示例**：

```SQL
CREATE TABLE test_vector (
    vec1 vector(float, 512),  -- 指定元素类型为float，维度为512
    vec2 vector(512),         -- 默认元素类型为float，维度为512
    vec3 vector(tinyint, 128) -- 指定元素类型为tinyint，维度为128
);
```

**创建向量**：

```SQL
SELECT vector(1, 2, 3); -- 根据提供的值自动推导元素类型，创建一个向量
```

## 使用限制

* 当前版本的向量类型不支持比较操作，因此不能用于`ORDER BY`或`GROUP BY`子句中。

## 向量类型转换

向量类型支持与数组类型之间的转换，以及从字符串类型转换为向量类型：

1. **隐式转换**：在大多数情况下，向量类型可以直接转换为数组类型，尽量保持元素类型不变。
2. **数组转向量**：数组类型也可以转换为向量类型，但必须确保数组长度与向量维度相匹配。不匹配时，转换结果为`NULL`。
3. **字符串转向量**：支持将符合格式`'[1, 2, 3]'`的字符串转换为向量类型（多余空格会被忽略）。


**示例**：

```SQL
-- 将向量隐式转换为数组
SELECT array_append(vector(1,2,3), 4);

-- 计算两个向量之间的L2距离
SELECT l2_distance(array(1,2,3), vector(3,2,1));

-- 显式将字符串转换为向量
SELECT cast('[1,2,3,4]' as vector(4));
```

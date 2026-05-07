### 数组包含函数：ARRAY_CONTAINS

```
array_contains(array, value)
```

#### 功能描述
ARRAY_CONTAINS 函数用于判断一个数组（array）是否包含指定的值（value）。当指定的值存在于数组中时，函数返回 true，否则返回 false。

#### 参数说明
- array: `array<T>`，表示要进行搜索的数组。
- value: T 类型，表示要查找的元素值。

#### 返回类型
- 返回一个布尔值（boolean），当数组包含指定值时返回 true，否则返回 false。

#### 使用示例
1. 判断数组中是否包含特定元素：
   ```sql
   SELECT array_contains(array(1, 2, 3, 4, 5), 3); -- 返回 true
   SELECT array_contains(array(1, 2, 3, 4, 5), 6); -- 返回 false
   ```
   
2. 在实际查询中使用 ARRAY_CONTAINS 函数：
   ```sql
   SELECT * FROM students
   WHERE array_contains(interests, 'Basketball');
   ```
   上述查询将返回 interests 数组中包含 'Basketball' 兴趣的学生记录。

3. 多条件判断：
   ```sql
   SELECT * FROM products
   WHERE array_contains(features, 'Bluetooth') AND array_contains(features, 'Waterproof');
   ```
   上述查询将返回 features 数组中同时包含 'Bluetooth' 和 'Waterproof' 特性的产品记录。

通过使用 ARRAY_CONTAINS 函数，您可以方便地在 SQL 查询中实现对数组元素的判断和筛选，从而更精确地获取所需的数据。
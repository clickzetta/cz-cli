### BITMAP_ANDNOT 函数
```
bitmap_andnot(left, right)
```

#### 功能描述
BITMAP_ANDNOT 函数用于计算两个 bitmap 类型参数的集合差（andnot 运算），返回一个新的 bitmap 类型结果。该函数在处理大量数据时具有较高的性能优势。

#### 参数说明
* left, right: 这两个参数均为 bitmap 类型，分别表示进行集合差运算的左侧和右侧 bitmap 数据。

#### 返回结果
返回一个新的 bitmap 类型结果，其中包含左侧 bitmap 中存在但右侧 bitmap 中不存在的元素。

#### 使用示例
1. 计算两个简单 bitmap 的集合差：
```sql
SELECT bitmap_andnot('01', '10');
```
结果：`00`

2. 使用数组构建 bitmap 并计算集合差：
```sql
SELECT bitmap_to_array(bitmap_andnot(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4))));
```
结果：按 array 形式表示为 `[1]`，具体客户端支持的 bitmap 打印方式可能有所不同。

3. 计算两个较大规模的 bitmap 集合差：
```sql
SELECT bitmap_to_array(bitmap_andnot(
  bitmap_build(array(1, 2, 3, 4, 5, 6, 7, 8, 9)),
  bitmap_build(array(3, 4, 5, 6, 7, 8, 9, 10))
));
```
结果：按 array 形式表示为 `[1, 2]`

4. 在实际业务场景中，可以利用 BITMAP_ANDNOT 函数对用户兴趣标签进行筛选。例如，从兴趣标签库中排除掉某些特定用户群体不感兴趣的标签：
```sql
SELECT user_interests
FROM users
WHERE user_id = 1;
```
假设上述查询结果为：
```
user_id | user_interests
--------+-----------------
1       | 0000000000001111
```
现在我们要排除掉用户不感兴趣的标签 4 和 5：
```sql
SELECT bitmap_andnot(user_interests, bitmap_build(array(4, 5)))
FROM users
WHERE user_id = 1;
```
结果：
```
user_id | user_interests
--------+-----------------
1       | 0000000000000101
```
通过 BITMAP_ANDNOT 函数，我们成功地从用户兴趣标签中排除了不感兴趣的标签 4 和 5。
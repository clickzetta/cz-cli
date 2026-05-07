### BITMAP_AND_CARDINALITY 函数

#### 概述
`BITMAP_AND_CARDINALITY` 函数用于计算两个 bitmap 类型参数的集合交集，并返回结果集中的元素数量。该函数在处理大量数据时具有较高的性能优势，特别适用于需要快速计算集合关系的场景。

#### 语法
```
bitmap_and_cardinality(left, right)
```
#### 参数说明

* `left` (bitmap 类型): 第一个输入的 bitmap 数据。
* `right` (bitmap 类型): 第二个输入的 bitmap 数据。

#### 返回结果
返回一个 bigint 类型的值，表示两个输入 bitmap 交集中的元素数量。

#### 使用示例

**示例 1**：计算两个简单 bitmap 的交集元素数量
```sql
SELECT bitmap_and_cardinality(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
```
结果：
```
2
```
在这个例子中，两个 bitmap 分别为 `{1, 2, 3}` 和 `{2, 3, 4}`，它们的交集为 `{2, 3}`，因此结果为 2。

**示例 2**：结合实际数据表计算交集元素数量
假设我们有一个名为 `users` 的数据表，其中包含以下列：`id`, `username`, `interests`。`interests` 列存储了用户的兴趣爱好，数据类型为 bitmap。

现在，我们想要计算喜欢“篮球”和“足球”的用户数量。可以使用以下 SQL 查询实现：
```sql
SELECT bitmap_and_cardinality(
    bitmap_or(
        bitmap_and(interests, 'basketball'),
        bitmap_and(interests, 'football')
    ),
    interests
) AS shared_interests_count
FROM users;
```
在这个例子中，我们首先使用 `bitmap_and` 函数筛选出喜欢“篮球”和“足球”的用户，然后使用 `bitmap_or` 函数计算这两个集合的并集。最后，使用 `bitmap_and_cardinality` 函数计算并集中的元素数量，即喜欢“篮球”和“足球”的用户数量。

#### 注意事项
* 确保输入参数的数据类型为 bitmap，否则会导致函数执行失败。
* 当输入的 bitmap 为空时，函数返回 0。
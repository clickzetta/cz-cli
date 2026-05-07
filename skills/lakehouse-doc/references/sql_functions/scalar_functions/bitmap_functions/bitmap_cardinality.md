### BITMAP_CARDINALITY 函数

#### 功能描述
BITMAP_CARDINALITY 函数用于计算 bitmap 类型中元素的个数。该函数接受一个 bitmap 类型的参数，并返回一个 bigint 类型的值，表示 bitmap 中元素的个数。

#### 参数说明
- bitmap: 输入的 bitmap 类型数据。

#### 返回结果
- 返回一个 bigint 类型的值，表示 bitmap 中元素的个数。

#### 使用示例
1. 计算单个 bitmap 的元素个数：
   ```sql
   SELECT bitmap_cardinality(bitmap_build(ARRAY[1, 2, 3, 4, 5]));
   ```
   结果：
   ```
   5
   ```
   上述示例中，我们使用 `bitmap_build` 函数创建了一个包含 1 到 5 的 bitmap，并使用 `bitmap_cardinality` 函数计算出该 bitmap 中元素的个数为 5。

2. 计算多个 bitmap 组合后的元素个数：
   ```sql
   SELECT bitmap_cardinality(bitmap_union(bitmap_build(ARRAY[1, 2]), bitmap_build(ARRAY[3, 4])));
   ```
   结果：
   ```
   4
   ```
   在这个示例中，我们分别创建了两个 bitmap，一个包含 1 和 2，另一个包含 3 和 4。然后使用 `bitmap_union` 函数将这两个 bitmap 合并，最后使用 `bitmap_cardinality` 函数计算合并后的 bitmap 中元素的个数为 4。

3. 计算两个 bitmap 交集的元素个数：
   ```sql
   SELECT bitmap_cardinality(bitmap_intersect(bitmap_build(ARRAY[1, 2, 3]), bitmap_build(ARRAY[2, 3, 4])));
   ```
   结果：
   ```
   2
   ```
   在这个示例中，我们创建了两个 bitmap，一个包含 1、2 和 3，另一个包含 2、3 和 4。使用 `bitmap_intersect` 函数计算两个 bitmap 的交集，然后使用 `bitmap_cardinality` 函数计算交集结果中元素的个数为 2。

通过以上示例，您可以更好地理解 BITMAP_CARDINALITY 函数的使用方法和场景。在实际应用中，您可以根据需要创建和操作 bitmap 类型数据，并利用该函数计算元素个数。
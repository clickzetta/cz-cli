### SUB_BITMAP 函数

#### 功能描述
SUB_BITMAP 函数用于从原始 bitmap 类型数据中提取一个子集，该子集从指定的 offset 位置开始，最多包含 limit 个元素。该函数仅适用于整数类型的 bitmap 数据。

#### 参数说明
* `bitmap`: 需要进行子集提取的原始 bitmap 类型数据。
* `offset`: 开始提取子集的位置（整数类型）。
* `limit`: 需要提取的子集最大长度（整数类型）。

#### 返回结果
返回一个 bitmap 类型的数据，包含从 offset 位置开始的最多 limit 个元素的子集。

#### 使用示例
1.  提取从位置 1 开始的 1 个元素的子集：
    ```sql
   SELECT sub_bitmap(bitmap_build(array(2, 1, 3)), 1, 1);
   -- 结果：[1]
   ```
2.  提取从位置 0 开始的 2 个元素的子集：
    ```sql
   SELECT sub_bitmap(bitmap_build(array(2, 1, 3, 4, 5)), 0, 2);
   -- 结果：[2, 1]
   ```
3.  提取从位置 2 开始的 3 个元素的子集：
    ```sql
   SELECT sub_bitmap(bitmap_build(array(2, 1, 3, 4, 5, 6, 7, 8, 9)), 2, 3);
   -- 结果：[3, 4, 5]
   ```

#### 注意事项
* 当 `offset` 或 `limit` 参数超出原始 bitmap 数据范围时，函数将返回一个空的 bitmap。
* 如果 `limit` 参数大于原始 bitmap 数据长度减去 `offset` 后的结果，实际提取的子集长度将等于原始数据长度减去 `offset` 后的结果。
* 客户端不支持直接打印 bitmap 类型的结果，直接查看会报错。因此，如需显示，需要使用 `bitmap_to_array` 函数将其转换为数组。

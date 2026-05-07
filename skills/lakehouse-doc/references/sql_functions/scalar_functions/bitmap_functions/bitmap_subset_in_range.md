### BITMAP_SUBSET_IN_RANGE 函数

``` sql
bitmap_subset_in_range(bitmap, range_start, range_end)
```

#### 功能描述
BITMAP_SUBSET_IN_RANGE 函数用于从给定的 bitmap 中提取一个指定区间的子集。该区间以 range_start 为起始点（包含），以 range_end 为结束点（不包含）。当前版本仅支持 int 类型的区间数值。

#### 参数说明
- bitmap: 输入的 bitmap 类型数据。
- range_start: 区间起始点，int 类型数据。起始值是1
- range_end: 区间终点，int 类型数据。

#### 返回类型
返回一个 bitmap 类型数据，包含指定区间内的元素。

#### 使用示例

1. 提取区间 [1, 3) 的子集：

``` sql
SELECT bitmap_subset_in_range(bitmap_build(array(2, 1, 3, 4)), 1, 3);
```

结果：

```
[1, 2]
```

2. 提取区间 [5, 7) 的子集（结果为空，因为区间内没有元素）：

``` sql
SELECT bitmap_subset_in_range(bitmap_build(array(1, 3, 5, 7, 9)), 5, 7);
```

结果：

```
[]
```

3. 从一个包含多个元素的 bitmap 中提取区间 [2, 5) 的子集：

``` sql
SELECT bitmap_subset_in_range(bitmap_build(array(1, 2, 3, 4, 5, 6, 7, 8, 9)), 2, 5);
```

结果：

```
[2, 3, 4]
```

#### 注意事项
- 请确保输入的 bitmap 类型数据有效。
- 当区间为空时，返回结果将是一个空的 bitmap 类型数据。
- 请确保 range_start 和 range_end 的值是有效的 int 类型数值。
- 客户端不支持直接打印 bitmap 类型的结果，如果直接查看 bitmap 结果会报错，因此在实际使用中如需显示，需要使用 bitmap_to_array 转换成 array。
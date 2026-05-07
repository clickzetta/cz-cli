### 将 Bitmap 转换为 Array 函数：bitmap_to_array

#### 功能描述
`bitmap_to_array` 函数的主要功能是将传入的 bitmap 类型数据转换成一个 `array<bigint>` 类型的数据。该函数在处理位图数据以及需要将位图转换为数组的场景下非常有用。

#### 函数语法
```
bitmap_to_array(bitmap)
```
* `bitmap`：需要转换的 bitmap 类型数据。

#### 返回类型
该函数返回一个 `array<bigint>` 类型的数据。

#### 使用示例
以下是 `bitmap_to_array` 函数的几个使用示例：

示例 1：结合 `bitmap_build` 函数，将整数数组转换为位图，然后再将位图转换回整数数组。
```sql
SELECT bitmap_to_array(bitmap_build(array(1, 2, 3)));
-- 返回结果为 [1, 2, 3]
```

通过上述示例，可以看到 `bitmap_to_array` 函数在处理位图数据时的灵活性和实用性。在实际应用中，您可以根据需要将位图数据与数组进行转换，以便进行更复杂的数据处理和分析。
### 函数名称：BINARY_TO_BITMAP

```
binary_to_bitmap(binary)
```

#### 功能描述
`binary_to_bitmap` 函数的主要作用是将 binary 类型的输入数据转换为 bitmap 类型。该函数通常与 `bitmap_to_binary` 函数配合使用，后者将 bitmap 类型转换为 binary 类型。这种转换在处理位图数据时非常有用，尤其是在需要在不同数据格式之间进行转换的场景中。

#### 参数说明
* binary：待转换的 binary 类型数据。

#### 返回结果
返回转换后的 bitmap 类型数据。

#### 使用示例

1. 通过 `bitmap_build` 函数创建一个位图数组，并使用 `bitmap_to_binary` 函数将其转换为 binary 类型，最后使用 `binary_to_bitmap` 函数将其还原为 bitmap 类型：
```sql
SELECT binary_to_bitmap(bitmap_to_binary(bitmap_build(array(1,2,3))));
-- 返回结果：[1,2,3]
```


#### 注意事项
- 确保输入的 binary 数据是有效的，否则函数可能无法正确执行。
- 在实际应用中，可能需要结合其他位图函数来实现更复杂的操作。建议在使用 `binary_to_bitmap` 函数之前，先了解相关函数的使用方法。

通过以上示例和说明，您可以更好地理解 `binary_to_bitmap` 函数的用途和使用方法。在处理位图数据时，该函数可以帮助您在不同数据格式之间轻松转换，从而提高数据处理的效率。
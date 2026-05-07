### BITMAP_TO_BINARY 函数

#### 功能描述
BITMAP_TO_BINARY 函数用于将 bitmap 类型的数据转换为 binary 类型。binary 类型通常用于存储二进制数据，可以方便地在不同的系统和应用程序之间传输和处理。

#### 函数语法
```
BITMAP_TO_BINARY(bitmap)
```

#### 参数说明
* bitmap: 需要转换的 bitmap 类型数据。

#### 返回结果
* 返回转换后的 binary 类型数据。

#### 使用示例

1. 将多个 bitmap 值转换为 binary 类型，并存储在数组中：
   ```sql
   SELECT binary_to_bitmap(BITMAP_TO_BINARY(bitmap_build(array(1, 2, 3))));
   ```
    结果：
   ```
   [1,2,3]
   ```

通过以上示例，您可以看到 BITMAP_TO_BINARY 函数在不同场景下的应用。使用此函数可以方便地在 bitmap 和 binary 类型之间进行转换，以便在不同的环境中处理和传输数据。
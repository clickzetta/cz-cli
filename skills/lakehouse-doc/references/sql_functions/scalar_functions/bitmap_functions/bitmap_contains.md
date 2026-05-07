### BITMAP_CONTAINS 函数

---

#### 功能描述
BITMAP_CONTAINS 函数用于检查一个 bitmap 类型的数据结构中是否包含指定的值。当给定的值存在于 bitmap 中时，函数返回 true，否则返回 false。

#### 函数语法
```
bitmap_contains(bitmap, value)
```

- **bitmap**: 待检查的 bitmap 类型数据。
- **value**: 需要查询的整数值。

#### 返回结果
返回一个布尔值，表示 bitmap 中是否包含指定的 value。

#### 使用示例
以下示例展示了如何使用 BITMAP_CONTAINS 函数来检查 bitmap 中是否包含特定的值：

1. 检查 bitmap 中是否包含值 2：
   ```sql
   SELECT bitmap_contains(bitmap_build(array(1, 2, 3)), 2);
   -- 结果：true
   ```

2. 检查 bitmap 中是否包含值 4：
   ```sql
   SELECT bitmap_contains(bitmap_build(array(1, 2, 3)), 4);
   -- 结果：false
   ```

3. 创建一个包含多个值的 bitmap，并检查是否包含特定的值：
   ```sql
   SELECT bitmap_contains(bitmap_build(array(10, 20, 30, 40, 50)), 30);
   -- 结果：true
   ```

4. 检查 bitmap 中是否包含多个不同的值：
   ```sql
   SELECT bitmap_contains(bitmap_build(array(1, 15, 22, 33, 45, 55, 66, 77, 88, 99, 100)), 45);
   -- 结果：true
   ```

#### 注意事项
- 确保 value 参数是一个整数，否则可能会导致函数执行错误。
- BITMAP_CONTAINS 函数适用于快速检查大量数据中某个特定值是否存在，以提高查询效率。

通过以上示例和说明，您可以更好地理解 BITMAP_CONTAINS 函数的用途和用法。在实际应用中，您可以根据需要创建和查询 bitmap 数据结构，以实现高效的数据管理和查询。
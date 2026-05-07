### BITMAP_HAS_ALL 函数
```
bitmap_has_all(left, right)
```

#### 功能描述
BITMAP_HAS_ALL 函数用于检查第二个参数（right）的 bitmap 是否是第一个参数（left）的子集。当 right bitmap 中的所有位都在 left bitmap 中时，返回 true，否则返回 false。

#### 参数说明
- left: 输入的第一个 bitmap 类型参数。
- right: 输入的第二个 bitmap 类型参数。

#### 返回类型
返回值类型为布尔值（boolean）。

#### 使用示例
1. 检查两个 bitmap 是否有包含关系：
```sql
SELECT bitmap_has_all(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3)));
-- 返回结果：true
```
在这个例子中，right bitmap（2, 3）是 left bitmap（1, 2, 3）的子集，因为 right bitmap 中的所有位都在 left bitmap 中，所以返回 true。

2. 检查两个 bitmap 是否没有包含关系：
```sql
SELECT bitmap_has_all(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3, 4)));
-- 返回结果：false
```
在这个例子中，right bitmap（2, 3, 4）不是 left bitmap（1, 2, 3）的子集，因为 right bitmap 包含了 left bitmap 中没有的位（4），所以返回 false。

3. 检查一个 bitmap 是否包含另一个 bitmap 的所有位：
```sql
SELECT bitmap_has_all(bitmap_build(array(1, 2, 3, 4)), bitmap_build(array(3, 4)));
-- 返回结果：true
```
在这个例子中，left bitmap（1, 2, 3, 4）包含了 right bitmap（3, 4）的所有位，所以返回 true。

4. 检查一个 bitmap 是否不包含另一个 bitmap 的所有位：
```sql
SELECT bitmap_has_all(bitmap_build(array(1, 2, 3, 5)), bitmap_build(array(4, 5, 6)));
-- 返回结果：false
```
在这个例子中，left bitmap（1, 2, 3, 5）不包含 right bitmap（4, 5, 6）的所有位，因为 left bitmap 中缺少 right bitmap 中的位（4）和位（6），所以返回 false。

#### 注意事项
- 当 left 或 right 参数为 NULL 时，函数将返回 NULL。
- 确保输入的参数类型正确，否则可能导致函数执行错误或返回意外结果。

通过以上示例和说明，您可以更好地理解 BITMAP_HAS_ALL 函数的用途和使用方法。在实际应用中，您可以根据需要对 bitmap 进行包含关系检查，以便进行相应的数据处理和分析。
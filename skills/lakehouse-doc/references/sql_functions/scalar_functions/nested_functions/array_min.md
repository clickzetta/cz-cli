### 数组最小值函数：ARRAY_MIN

#### 功能描述
`array_min` 函数用于从输入的数组中找出并返回最小值。在处理数值类型的数组时，该函数会将 `null` 值忽略不计。这使得用户能够轻松地处理包含空值的数组，而不必担心其对结果的影响。

#### 语法
```
array_min(array)
```

#### 参数
- `array`: `array<T>` 类型的参数，表示将要从中查找最小值的数组。

#### 返回结果
- 返回类型根据输入数组的元素类型推导得出：`T <- array<T>`。如果数组为空或全部为 `null` 值，则返回 `null`。

#### 使用示例

**例 1：** 找出整数数组中的最小值
```sql
SELECT array_min(array(1, 5, 3, 2, 4));
```
结果：
```
1
```

**例 2：** 处理包含 `null` 值的数组
```sql
SELECT array_min(array(1, null, 3, null, 2));
```
结果：
```
1
```

**例 3：** 在数组中查找最小浮点数值
```sql
SELECT array_min(array(1.2, 4.5, 3.7, 2.9));
```
结果：
```
1.2
```

**例 4：** 返回空数组的最小值
```sql
SELECT array_min(array());
```
结果：
NULL

**例 5：** 处理全部为 `null` 值的数组
```sql
SELECT array_min(array(null, null, null));
```
结果：
NULL

通过上述示例，您可以看到 `array_min` 函数在不同情况下的应用。此函数非常适合在需要比较数组中元素大小并找出最小值的场景中使用。
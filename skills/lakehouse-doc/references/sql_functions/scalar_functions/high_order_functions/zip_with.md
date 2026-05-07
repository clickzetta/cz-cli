### ZIP_WITH 函数

#### 功能描述
ZIP_WITH 函数能够根据提供的 lambda 表达式，对两个数组（array1 和 array2）的对应位置元素进行计算，并生成一个新的数组。当两个输入数组长度不一致时，较短数组的缺失元素位置将补入 NULL 值，然后继续进行计算。

#### 参数说明
- array1, array2: `array<T>` 类型，需要进行操作的两个数组。
- `(x1, x2) -> expr`: 二参形式的 lambda 表达式，其中 `x1` 对应 `array1` 的元素，`x2` 对应 `array2` 的元素。`expr` 为表达式内容，其返回值的类型没有限制。

#### 返回类型
返回一个新的数组，其元素类型与 lambda 表达式返回值的类型一致。

#### 使用示例
1. 两个数组对应元素相加，并转换为字符串类型：
```sql
SELECT zip_with(array(1, 2), array(2, 3), (x, y) -> CAST((x + y) AS string));
-- 返回结果：["3", "5"]
```
2. 计算两个数组对应元素的差值：
```sql
SELECT zip_with(array(5, 3, 1), array(2, 4, 6), (x, y) -> x - y);
-- 返回结果：[3, -1, -5]
```
3. 将两个数组对应元素拼接成新的字符串：
```sql
SELECT zip_with(array('a', 'b'), array('x', 'y'), (x, y) -> CONCAT(x, y));
-- 返回结果：['ax', 'by']
```
4. 当数组长度不一致时，较短数组的缺失元素位置将补入 NULL 值：
```sql
SELECT zip_with(array(1, 2), array(2, 3, 4), (x, y) -> x * y);
-- 返回结果：[2, 6, null]
```
#### 注意事项
- 当输入的数组为空时，ZIP_WITH 函数将返回一个空数组。
- 当 lambda 表达式中使用到 NULL 值时，其行为应符合 SQL 中对 NULL 的处理规则。

通过以上描述和示例，您可以更好地理解并使用 ZIP_WITH 函数来处理数组数据。
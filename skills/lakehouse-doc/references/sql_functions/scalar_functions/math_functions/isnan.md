### ISNAN 函数
```
isnan(expr)
```
#### 功能描述
`ISNAN` 函数用于判断传入的表达式 `expr` 是否为 `NaN`（Not a Number，非数字）。当 `expr` 的值为 `NaN` 时，函数返回 `true`，否则返回 `false`。该函数主要用于处理数值异常情况，确保数据的准确性。

#### 参数说明
* `expr`: 需要判断的表达式，类型为 `double`。

#### 返回类型
返回结果为 `boolean` 类型，即 `true` 或 `false`。

#### 使用示例
1.  判断字符串 `'NaN'` 转换为 `double` 类型后是否为 `NaN`：
    ```sql
   SELECT isnan(cast('NaN' as double)); -- 结果为 true
   ```
2.  在一个查询中使用 `ISNAN` 函数来过滤 `NaN` 值：
    ```sql
   SELECT * FROM orders WHERE isnan(total_amount);
   ```
    在这个例子中，如果 `total_amount` 列中存在 `NaN` 值，`ISNAN` 函数将返回 `true`，从而帮助过滤出这些记录。
3.  判断一个计算结果是否为 `NaN`，并根据结果进行条件筛选：
    ```sql
   SELECT * FROM products WHERE isnan(discount_price);
   ```

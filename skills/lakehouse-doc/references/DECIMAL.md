# DECIMAL
`DECIMAL`类型用于表示具有特定最大精度和固定小数位数的数值。这种数据类型在处理金融、会计或其他需要精确数值计算的场景中非常有用，因为它可以避免浮点数运算的舍入误差。

## 语法
```
DECIMAL(precision, scale)
```
* `precision`：表示数字的总位数，包括小数点两侧的位数。取值范围为1到38。
* `scale`：表示小数点后的位数。取值范围为0到`precision`，且不能大于`precision`。

## 示例
```
SELECT CAST(1234.56 AS DECIMAL(10, 2));  -- 结果为 1234.56
SELECT CAST(123.456 AS DECIMAL(5, 3));   -- 结果为 null
SELECT CAST(1.23 AS DECIMAL(4, 2));      -- 结果为 1.23
SELECT CAST(1234 AS DECIMAL(6, 2));      -- 结果为 1234.00
SELECT CAST(0.1234 AS DECIMAL(5, 4));    -- 结果为 0.1234
```

## 使用指南
- 当`scale`为0时，表示数值为整数。
- 当`precision`和`scale`的值相同时，表示数值为纯小数（即所有位数都在小数点后）。
- 在进行数值转换时，如果转换结果超出了`DECIMAL`类型的范围，可能会发生数据截断或舍入。
- 在比较`DECIMAL`类型的数值时，应考虑其精度和尺度，以避免因舍入误差导致的比较错误。

## 注意事项
- 在使用`DECIMAL`类型时，应根据实际需求合理选择`precision`和`scale`的值，以确保数值的精确性和计算的准确性。

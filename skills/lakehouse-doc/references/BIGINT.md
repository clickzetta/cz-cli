# BIGINT

`BIGINT` 是一种数据类型，用于表示 8 字节的带符号整数。它的数值范围为 -9,223,372,036,854,775,808 到 9,223,372,036,854,775,807。这种类型通常用于存储非常大的整数值。

## 语法

```
BIGINT [ + | - ] digit [ ... ] [L]
```

- `digit`：表示 0 到 9 的任意数字。
- `L`：表示字面量后缀，用于指示这是一个 `BIGINT` 类型的数值。如果数值不在 `INT` 范围内，即使没有 `L` 后缀，也会自动转换为 `BIGINT` 类型。

## 使用示例

1. 插入一个正数 `BIGINT` 值：

```
INSERT INTO my_table (my_column) VALUES (+1L);
```

2. 插入一个负数 `BIGINT` 值：

```
INSERT INTO my_table (my_column) VALUES (-1L);
```

3. 插入一个不带 `L` 后缀的 `BIGINT` 值（如果数值在 `INT` 范围内，会隐式转换为 `INT` 类型）：

```
INSERT INTO my_table (my_column) VALUES (123456789);
```

4. 在查询中使用 `BIGINT` 类型的数值进行比较：

```
SELECT * FROM my_table WHERE my_column = 9223372036854775807;
```

5. 使用 `CAST` 函数将其他类型的数值转换为 `BIGINT`：

```
SELECT CAST(123.456 AS BIGINT);
```

## 注意事项

- 当使用 `BIGINT` 类型存储数值时，请确保数值在允许的范围内，否则可能会导致溢出错误。
- 在进行数值比较或计算时，需要注意数据类型之间的隐式转换，以免出现意外的结果。
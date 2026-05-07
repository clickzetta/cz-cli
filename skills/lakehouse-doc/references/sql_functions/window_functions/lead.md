### LEAD 函数

#### 简介
LEAD 函数是窗口函数的一种，用于访问当前行之后指定偏移量的行。通过使用 LEAD 函数，您可以获取当前行向分区尾部方向移动指定行数后对应的表达式的值。这在数据分析和处理中非常有用，例如比较当前行与下一行的数据差异。

#### 语法
```sql
LEAD(expr[, offset[, default]]) OVER ([PARTITION BY clause] ORDER BY clause)
```

#### 参数
- `expr`: 任意类型的表达式，可以是列名、常量或函数等。
- `offset`: 可选参数，bigint 类型常量，默认值为 1，表示当前行后面的一行。当 offset 为 0 时，表示当前行本身。
- `default`: 可选参数，当 offset 超过窗口的边界时使用的缺省值。类型与 expr 相同，默认值为 null。

#### 返回结果
返回值类型与 expr 相同。

#### 使用示例

1. 基本使用
```sql
SELECT a, b, LEAD(b) OVER (PARTITION BY a ORDER BY b) as next_b FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```
结果：
```
A	1	1
A	1	2
A	2	null
B	3	null
```

2. 使用 offset 和 default 参数
```sql
SELECT a, b, LEAD(b, 2, 0) OVER (PARTITION BY a ORDER BY b) as next_b FROM VALUES ('A', 2), ('A', 1), ('B', 3), ('A', 1) tab(a, b);
```
结果：
```
A	1	2
A	1	0
A	2	0
B	3	0
```


#### 注意事项
- 当 offset 值超出窗口边界时（例如，当前行之后没有足够的行），LEAD 函数将返回 default 参数指定的值。
- LEAD 函数通常与窗口函数的 ORDER BY 子句一起使用，以确定如何访问相关行。
- 在使用 LEAD 函数时，请确保正确设置 PARTITION BY 子句，以便正确地对数据进行分区。
### WM_CONCAT 函数

#### 概述

`WM_CONCAT` 函数用于将一列的值通过指定的分隔符进行连接。此函数可以处理字符串类型数据，并在连接时可以选择去重或保留所有值。

#### 语法

```sql
wm_concat([DISTINCT] separator, col)
```

#### 参数说明

* `separator`: 字符串类型常量,作为连接值的分隔符。
* `col`: 字符串类型,需要进行连接的列。

#### 返回结果

返回一个字符串类型的值，其中包含连接后的结果。如果设置了`DISTINCT`关键字,则计算去重后的集合；否则,保留所有值。`NULL`值不参与计算。

#### 使用示例

1. 使用&&拼接

```sql
SELECT wm_concat('&&', col) FROM VALUES ('row1'), (NULL), ('row3') AS t(col);
+----------------------+
| wm_concat('&&', col) |
+----------------------+
| row1&&row3           |
+----------------------+
```

2. 带分隔符的连接：

```sql
SELECT wm_concat(',', col) FROM VALUES (1), (NULL), (3) AS t(col);
+---------------------+
| wm_concat(',', col) |
+---------------------+
| 1,3                 |
+---------------------+
```

3. 去重连接并分组：

```sql
SELECT k, wm_concat(DISTINCT '|', v)
FROM VALUES
(1, 'ALLEN'),
(1, NULL),
(1, 'ALLEN'),
(2, 'KING'),
(2, 'ALEX') AS t(k, v) GROUP BY k;
+---+----------------------------+
| k | wm_concat(DISTINCT '|', v) |
+---+----------------------------+
| 1 | ALLEN                      |
| 2 | KING|ALEX                  |
+---+----------------------------+
```

4. 连接时处理空格和特殊字符：

```sql
SELECT wm_concat(' - ', col) FROM VALUES ('John Doe'), ('Jane Smith'), (NULL), ('Alice Jones') AS t(col);
+-------------------------------------+
|        wm_concat(' - ', col)        |
+-------------------------------------+
| John Doe - Jane Smith - Alice Jones |
+-------------------------------------+
```

#### 注意事项

* 当`col`列中的值为`NULL`时,`WM_CONCAT`函数不会将其包含在结果中。
* 如果需要连接的列中包含空格或特殊字符，请确保使用适当的分隔符以避免歧义。
* 使用`DISTINCT`关键字可以有效地去除重复的字符串值,但请注意,这可能会影响性能。在处理大量数据时,请谨慎使用此选项。

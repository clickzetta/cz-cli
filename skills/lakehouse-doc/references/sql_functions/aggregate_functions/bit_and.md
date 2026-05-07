### BIT_AND 函数

```sql
bit_and([DISTINCT] expr) [FILTER (WHERE condition)]
```

#### 功能描述

`BIT_AND` 函数用于计算指定表达式在一组数据中的按位与结果。该函数对整数类型的数据进行操作，包括 `TINYINT`、`SMALLINT`、`INT` 和 `BIGINT` 类型。通过使用 `BIT_AND` 函数，可以对数据进行位运算，从而实现对数据的精确控制和处理。

#### 参数说明

* `expr` (必需): 整数类型的表达式，包括 `TINYINT`、`SMALLINT`、`INT` 和 `BIGINT` 类型。
* `DISTINCT` (可选): 当设置为 `DISTINCT` 时，函数将计算去重后的集合的按位与结果。

#### 返回结果

* 返回值类型与参数类型一致。
* 如果设置了 `DISTINCT`，则返回去重后的集合的按位与结果。
* `NULL` 值不参与计算。

#### 使用示例

1.  计算一组数据的按位与结果（未设置 `DISTINCT`）：

    ```sql
SELECT bit_and(col) FROM VALUES (3), (5), (7) AS tab(col);
+--------------+
| bit_and(col) |
+--------------+
| 1            |
+--------------+
```

2.  计算一组数据的按位与结果（设置 `DISTINCT` 并包含重复值）：

    ```sql
SELECT bit_and(DISTINCT col) FROM VALUES (3), (3), (5), (7), (NULL) AS tab(col);
+-----------------------+
| bit_and(DISTINCT col) |
+-----------------------+
| 1                     |
+-----------------------+
```

3.  计算一组数据的按位与结果（包含 `NULL` 值）：

    ```sql
SELECT bit_and(col) FROM VALUES (3), (NULL), (5), (7) AS tab(col);
+--------------+
| bit_and(col) |
+--------------+
| 1            |
+--------------+
```

4.  计算不同整数类型的按位与结果：

    ```sql
SELECT bit_and(tinyint_col) AS col1,
       bit_and(smallint_col) AS col2,
       bit_and(int_col) AS col3,
       bit_and(bigint_col) AS col4
FROM VALUES (11, 22, 33, 44) AS t(tinyint_col, smallint_col, int_col, bigint_col);
+------+------+------+------+
| col1 | col2 | col3 | col4 |
+------+------+------+------+
| 11   | 22   | 33   | 44   |
+------+------+------+------+
```

5.  使用 FILTER 子句条件性地计算按位与：

    ```sql
SELECT bit_and(col) FILTER (WHERE col > 3) FROM VALUES (3), (5), (7), (9) AS tab(col);
+---------------------------------------+
| bit_and(col) FILTER (WHERE (col > 3)) |
+---------------------------------------+
| 5                                     |
+---------------------------------------+
```

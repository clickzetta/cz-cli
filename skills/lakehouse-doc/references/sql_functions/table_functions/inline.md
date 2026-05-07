### 函数：INLINE

```sql
INLINE(expr)
```

#### 功能描述

`INLINE` 函数用于将数组中的结构体元素展开成多行数据。输入参数 `expr` 为 `array<struct<T1, T2, ... Tn>>` 类型,展开后的每一列对应结构体元素中的一个字段。如果未指定列名,展开后的列名将与结构体字段名相同。`INLINE` 函数可以直接使用,也可以与 `LATERAL VIEW` 搭配使用以实现更复杂的数据处理。

#### 参数说明

* `expr` : 输入的数组表达式,类型为 `array<struct<T1, T2, ... Tn>>`

#### 返回结果

* 返回类型：根据输入参数 `expr` 进行类型推导,得到 `(T1, T2, ... Tn)` 类型的数据。

#### 使用示例

示例 1：简单的 INLINE 展开

```sql
SELECT INLINE(array(struct(1, 'x'), struct(2, 'y')));
+------+------+
| col1 | col2 |
+------+------+
| 1    | x    |
| 2    | y    |
+------+------+
```

示例 2：与 LATERAL VIEW 搭配使用

```sql
SELECT word, s1, s2 FROM VALUES ('hello') AS vt(word) LATERAL VIEW INLINE(array(struct('a', 0), struct('b', 1))) lv AS s1, s2;
+-------+----+----+
| word  | s1 | s2 |
+-------+----+----+
| hello | a  | 0  |
| hello | b  | 1  |
+-------+----+----+
```

#### 注意事项

* 使用 `INLINE` 函数时,请确保输入的数组元素类型为结构体类型。
* 在与 `LATERAL VIEW` 搭配使用时,注意为展开后的数据指定别名,以便后续操作使用。

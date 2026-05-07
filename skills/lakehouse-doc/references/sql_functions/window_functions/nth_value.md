# NTH\_VALUE 函数

## 简介

NTH\_VALUE 函数用于从指定窗口内返回第 offset 行的值。该函数在处理数据时非常有用，特别是当需要获取特定位置的数据时。

## 语法

```sql
nth_value(expr, offset[,ignoreNull]) over ([partition_clause] [orderby_clause] [frame_clause])
```

## 参数

* `expr`: 任意类型的表达式。
* `offset`: 大整数类型（BIGINT），必须是正整数常量。当 offset 为 1 时，函数行为与 FIRST\_VALUE 函数相同。
* `ignoreNull`: 可选参数，布尔类型常量，默认为 false。当设置为 true 时，函数将返回窗口内第 offset 个非 null 的值。

## 返回结果

返回值类型与 expr 类型相同。

## 使用示例

```sql
SELECT dep_no, salary, nth_value(salary, 3) OVER (PARTITION BY dep_no)
FROM VALUES
  ('Eric', 1, null),
  ('Alex', 1, 32000),
  ('Felix', 2, 21000),
  ('Frank', 1, 30000),
  ('Tom', 2, 23000),
  ('Jane', 3, 29000),
  ('Jeff', 3, 35000),
  ('Paul', 2, 29000),
  ('Charles', 2, 23000)
AS tab(name, dep_no, salary);
```

结果：

```
+--------+--------+---------------------------------------------------+
| dep_no | salary | `nth_value`(salary, 3) OVER (PARTITION BY dep_no) |
+--------+--------+---------------------------------------------------+
| 3      | 29000  | null                                              |
| 3      | 35000  | null                                              |
| 1      | null   | 30000                                             |
| 1      | 32000  | 30000                                             |
| 1      | 30000  | 30000                                             |
| 2      | 21000  | 29000                                             |
| 2      | 23000  | 29000                                             |
| 2      | 29000  | 29000                                             |
| 2      | 23000  | 29000                                             |
+--------+--------+---------------------------------------------------+
```



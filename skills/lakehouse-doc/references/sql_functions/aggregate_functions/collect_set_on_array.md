### 收集集合并转换为数组函数：COLLECT_SET_ON_ARRAY

```
collect_set_on_array([DISTINCT] expr [, limit])
```

#### 功能描述

`collect_set_on_array` 函数用于从输入的数组表达式中提取不重复的元素，并将这些元素组成一个新的数组。当指定 `DISTINCT` 关键字时，函数会对结果进行去重处理。但请注意，即使不指定 `DISTINCT`，该函数本身就具有去重的功能，因此 `DISTINCT` 关键字在此场景下并不会产生额外的效果。

#### 参数说明

* `expr`：输入的数组类型表达式。
* `limit`：可选参数，整数类型，表示最多收集的元素个数。如果不指定，则收集所有元素。

#### 返回结果

返回一个数组，数组中的元素类型与输入数组的元素类型相同。如果指定了 `limit` 参数，则返回的数组最多包含 `limit` 个元素。结果数组中的元素顺序不保证与输入数组相同，且数组中的 `NULL` 值不会参与计算。

#### 使用示例

以下示例展示了如何使用 `collect_set_on_array` 函数处理不同的输入数组，并返回去重后的结果数组。

示例 1：

```sql
SELECT array_sort(collect_set_on_array(a)) AS result
FROM VALUES
  (ARRAY(3, 3, 4)),
  (NULL),
  (ARRAY(2, 2, 3)),
  (ARRAY(NULL)),
  (ARRAY(1, NULL, 2)),
  (ARRAY(1, 2, 2))
AS t(a);
+-----------+
|  result   |
+-----------+
| [1,2,3,4] |
+-----------+
```

示例 2：

```sql
SELECT array_sort(collect_set_on_array(DISTINCT a)) AS result
FROM VALUES
  (ARRAY(1, 1, 2)),
  (ARRAY(2, 3, 3)),
  (ARRAY(4, 5, 5))
AS t(a);
+-------------+
|   result    |
+-------------+
| [1,2,3,4,5] |
+-------------+
```

示例 3：使用 limit 参数限制返回的元素个数

```sql
SELECT array_sort(collect_set_on_array(a, 3)) AS result
FROM VALUES
  (ARRAY(3, 3, 4)),
  (NULL),
  (ARRAY(2, 2, 3)),
  (ARRAY(NULL)),
  (ARRAY(1, NULL, 2)),
  (ARRAY(1, 2, 2))
AS t(a);
+---------+
| result  |
+---------+
| [2,3,4] |
+---------+
```

#### 注意事项

* 当输入数组全为 `NULL` 时，`collect_set_on_array` 函数将返回一个空数组。

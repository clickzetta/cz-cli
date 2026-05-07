### 收集列表到数组函数：COLLECT_LIST_ON_ARRAY

```
collect_list_on_array([DISTINCT] array [, limit])
```

#### 功能描述

该函数用于将输入的数组（`ARRAY`）中的元素收集到一个新的数组中，并返回该新数组。如果指定了 `DISTINCT` 参数，则返回的结果数组中的元素是去重后的。

#### 参数说明

* `array`：输入的数组（`ARRAY`）类型数据。
* `limit`：可选参数，整数类型，表示最多收集的元素个数。如果不指定，则收集所有元素。

#### 返回结果

* 返回一个数组（`ARRAY`）类型数据，其元素类型与输入数组的元素类型相同。
* 如果指定了 `DISTINCT` 参数，则返回的结果数组中的元素是唯一的（即重复元素会被去重）。
* 如果指定了 `limit` 参数，则返回的数组最多包含 `limit` 个元素。
* 函数不保证返回结果数组的元素顺序。
* 输入数组中的 `NULL` 值不会影响结果数组的计算。

#### 使用示例

以下示例展示了如何使用 `collect_list_on_array` 函数来收集数组中的元素并返回一个新数组。

示例 1：基本使用

```sql
SELECT collect_list_on_array(a)
FROM VALUES
  (ARRAY(3, 3, 4)),
  (NULL),
  (ARRAY(2, 2, 3)),
  (ARRAY(NULL)),
  (ARRAY(1, NULL, 2)),
  (ARRAY(1, 2, 2))
AS t(a);
+--------------------------+
| collect_list_on_array(a) |
+--------------------------+
| [3,3,4,2,2,3,1,2,1,2,2]  |
+--------------------------+
```

示例 2：使用 limit 参数限制返回的元素个数

```sql
SELECT collect_list_on_array(a, 5)
FROM VALUES
  (ARRAY(3, 3, 4)),
  (NULL),
  (ARRAY(2, 2, 3)),
  (ARRAY(NULL)),
  (ARRAY(1, NULL, 2)),
  (ARRAY(1, 2, 2))
AS t(a);
+-----------------------------+
| collect_list_on_array(a, 5) |
+-----------------------------+
| [3,3,4,2,2]                 |
+-----------------------------+
```

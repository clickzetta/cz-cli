### 收集列表函数：collect_list

```
collect_list([DISTINCT] expr [, limit]) [FILTER (WHERE condition)]
```

#### 功能描述

`collect_list` 函数用于从输入的一组数据中收集并返回一个数组。用户可以选择性地使用 `DISTINCT` 关键字来返回一个不包含重复元素的数组。

#### 参数说明

* `expr`：任意类型的表达式，用于从输入数据中收集元素。
* `limit`：可选参数，整数类型，表示最多收集的元素个数。如果不指定，则收集所有元素。

#### 返回结果

* 返回一个数组，数组中的元素类型与输入参数类型相同。
* 如果设置了 `DISTINCT` 关键字，则返回一个去重后的数组。
* 如果指定了 `limit` 参数，则返回的数组最多包含 `limit` 个元素。
* 函数不保证返回结果中元素的顺序。
* 如果输入数据包含 `NULL` 值，则这些值不会被包含在返回的数组中。

#### 使用示例

1. 返回包含非重复元素的数组：
```sql
SELECT collect_list(DISTINCT col) FROM VALUES (1), (2), (1), (NULL) AS tab(col);
+----------------------------+
| collect_list(DISTINCT col) |
+----------------------------+
| [2,1]                      |
+----------------------------+
```

2. 返回包含重复元素的数组：
```sql
SELECT collect_list(col) FROM VALUES (1), (2), (1), (NULL) AS tab(col);
+-------------------+
| collect_list(col) |
+-------------------+
| [1,2,1]           |
+-------------------+
```

3. 从字符串数据中收集字符：
```sql
SELECT collect_list(col)
FROM VALUES ("apple"), ("banana"), ("cherry"), (NULL) AS tab(col);
+-----------------------------+
|      collect_list(col)      |
+-----------------------------+
| ["apple","banana","cherry"] |
+-----------------------------+
```

4. 收集并返回包含 null 值的数组：
```sql
SELECT collect_list(col) FROM VALUES (true), (false), (null) AS tab(col);
+-------------------+
| collect_list(col) |
+-------------------+
| [true,false]      |
+-------------------+
```

5. 使用 FILTER 子句条件性地收集元素：
```sql
SELECT collect_list(col) FILTER (WHERE col > 1) FROM VALUES (1), (2), (3), (1) AS tab(col);
+--------------------------------------------+
| collect_list(col) FILTER (WHERE (col > 1)) |
+--------------------------------------------+
| [2,3]                                      |
+--------------------------------------------+
```

6. 结合 FILTER 子句和 DISTINCT 收集不重复的条件元素：
```sql
SELECT collect_list(DISTINCT col) FILTER (WHERE col <= 3) FROM VALUES (1), (2), (3), (3), (4) AS tab(col);
+-----------------------------------------------------------+
| collect_list(DISTINCT col) FILTER (WHERE (col <= 3))      |
+-----------------------------------------------------------+
| [3,2,1]                                                   |
+-----------------------------------------------------------+
```

7. 使用 limit 参数限制返回的元素个数：
```sql
SELECT collect_list(col, 2) FROM VALUES (1), (2), (3), (4) AS tab(col);
+----------------------+
| collect_list(col, 2) |
+----------------------+
| [1,2]                |
+----------------------+
```

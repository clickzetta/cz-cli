### MAP_AGG 函数

```
map_agg(key, value)
```

#### 功能描述

`MAP_AGG` 函数用于将键值对聚合成一个 `MAP` 类型的数据结构。该函数收集所有的键值对，并将它们组合成一个 Map，其中每个键对应一个值。

#### 参数说明

* `key`：任意可比较基本类型的表达式，作为 Map 的键。
  * `NULL` 键会被忽略。
  * 重复的键会保留第一个出现的值。
* `value`：任意类型的表达式，作为 Map 的值。
  * `value` 可以是 `NULL`。

#### 返回类型

* 返回 `map<key_type, value_type>` 类型（非空）。
* 返回包含所有键值对的 Map。

#### 注意事项

* 如果所有 `key` 都是 `NULL`，返回空 Map `{}`。
* 如果输入为空集，返回空 Map `{}`。
* `key` 的顺序在 Map 中是不确定的，不要依赖顺序。
* 重复 `key` 的行为可能因实现而异，建议避免使用重复的 `key`。

#### 使用示例

1. 基本用法：聚合键值对为 Map

```sql
SELECT map_agg(id, name)
FROM VALUES (1, 'Alice'), (2, 'Bob'), (3, 'Charlie') AS t(id, name);
+---------------------------------+
| map_agg(id, name)               |
+---------------------------------+
| {1:"Alice",2:"Bob",3:"Charlie"} |
+---------------------------------+
```

2. NULL key 会被忽略

```sql
SELECT map_agg(a, b)
FROM VALUES (1, 'apple'), (2, 'hi'), (NULL, 'good'), (3, NULL) AS t(a, b);
+--------------------------------+
| map_agg(a, b)                  |
+--------------------------------+
| {1:"apple",2:"hi",3:null}      |
+--------------------------------+
```

3. 重复的 key，保留第一个值

```sql
SELECT map_agg(a, b)
FROM VALUES (1, 'apple'), (2, 'hi'), (1, 'pie') AS t(a, b);
+-------------------------+
| map_agg(a, b)           |
+-------------------------+
| {1:"apple",2:"hi"}      |
+-------------------------+
```

4. 所有 key 都是 NULL 时返回空 Map

```sql
SELECT map_agg(a, b)
FROM VALUES (NULL, 'apple'), (NULL, 'banana') AS t(a, b);
+----------------+
| map_agg(a, b)  |
+----------------+
| {}             |
+----------------+
```

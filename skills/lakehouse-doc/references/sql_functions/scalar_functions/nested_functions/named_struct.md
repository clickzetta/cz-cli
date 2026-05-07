### 命名结构体函数：named_struct

#### 功能描述
`named_struct` 函数用于创建一个具有指定字段名（field name）和对应字段值（field value）的结构体（struct）。该函数能够将多个字段及其值组合成一个整体，便于在查询结果中以结构化的形式展示数据。

#### 语法格式
```
named_struct(f1, v1, f2, v2, ..., fN, vN)
```

#### 参数说明
- `f1, f2, ..., fN`: 字段名，类型为字符串（string），表示结构体中各个字段的名称。
- `v1, v2, ..., vN`: 字段值，类型为 `T1, T2, ..., TN`，表示结构体中各个字段对应的值。

#### 返回类型
- 返回一个结构体，包含 `f1:T1, f2:T2, ..., fN:TN` 等字段。

#### 使用示例

**示例 1：创建简单的命名结构体**
```sql
SELECT named_struct('id', 1, 'name', 'Alice');
```
返回结果：
```
{"id":1,"name":"Alice"}
```

**示例 2：结合其他函数创建复杂结构体**
```sql
SELECT named_struct('user', named_struct('id', 1, 'name', 'Alice'), 'created_time', '2022-01-01 10:00:00');
```
返回结果：
```
{"user":{"id":1,"name":"Alice"},"created_time":"2022-01-01 10:00:00"}
```

**示例 3：在查询中使用命名结构体**
```sql
SELECT id, named_struct('name', name, 'age', age) AS user_info
FROM users;
```
假设 `users` 表包含 `id`, `name`, `age` 三个字段，返回结果：
```
id | user_info
--- | ---------------------------------------------------------------------------------
1  | {"name":"Alice","age":30}
2  | {"name":"Bob","age":25}
...
```

#### 注意事项
- 请确保字段名 `f1, f2, ..., fN` 的值是有效的字符串，否则可能会导致函数执行失败。
- 当字段名与已有的字段名冲突时，需要使用别名或其他方法来避免冲突。
- 在使用 `named_struct` 函数时，请注意字段值的类型与结构体中字段类型的匹配，以确保数据的正确性。
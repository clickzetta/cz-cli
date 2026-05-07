### STRUCT_UPDATE 函数

#### 功能描述
`STRUCT_UPDATE` 函数用于更新一个结构体（struct）中的指定字段（field），将给定字段名对应的值替换为新的表达式值（expr）。需要注意的是，新值的类型可以与原值不同。

#### 参数说明
* `struct`: 需要更新的结构体（struct）。
* `name`: 待更新字段的名称，必须为字符串常量。
* `expr`: 用于替换原字段值的新表达式，可以是任意类型。

#### 返回结果
返回一个新的结构体（struct），其结构与原结构体相同，但已更新指定字段的值。

#### 使用示例
1. 假设我们有一个结构体 `s1`，包含两个字段：`"a"` 的值为 1，`"b"` 的值为 2。我们可以使用 `STRUCT_UPDATE` 函数将字段 `"a"` 的值更新为字符串 `"hello"`：
```sql
SELECT STRUCT_UPDATE(named_struct('a', 1, 'b', 2), 'a', 'hello');
```
执行结果为：
```json
{"a":"hello", "b":2}
```

2. 同样，我们也可以将字段 `"b"` 的值更新为字符串 `"hello"`：
```sql
SELECT STRUCT_UPDATE(named_struct('a', 1, 'b', 2), 'b', 'hello');
```
执行结果为：
```json
{"a":1, "b":"hello"}
```

3. 除了字符串，我们还可以使用其他类型的表达式来更新字段值，例如将字段 `"a"` 的值更新为当前时间戳：
```sql
SELECT STRUCT_UPDATE(named_struct('a', 1, 'b', 2), 'a', TIMESTAMP "2023-04-01 12:00:00");
```
执行结果为：
```json
{"a":2023-04-01 12:00:00, "b":2}
```

通过以上示例，您可以看到 `STRUCT_UPDATE` 函数在更新结构体字段时非常灵活且易于使用。
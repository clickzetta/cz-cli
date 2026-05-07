### 函数名称
`struct_insert`

### 概述
`struct_insert` 函数用于在结构体（struct）中插入一个新的字段。新字段的名称由 `name` 参数指定，其值为 `expr` 参数指定。可选的 `indexToInsert` 参数用于指定插入位置。如果未指定 `indexToInsert` 或其值为 0，则新字段将插入到结构体的末尾。如果 `indexToInsert` 为 1，则新字段将插入到第一个字段之后，以此类推。

### 功能
- 向结构体中添加新的字段。
- 通过 `indexToInsert` 参数控制新字段的插入位置。

### 参数
- `struct`: 需要插入新字段的结构体。
- `name`: 新字段的名称，必须为字符串常量。
- `expr`: 新字段的值，可以是任意类型的数据。
- `indexToInsert`: （可选）指定新字段的插入位置，为整数常量，默认值为 0。

### 返回结果
返回一个新的结构体，其结构取决于插入的键值对和指定的插入位置。

### 使用示例
1. 向结构体末尾添加新字段：
   ```sql
   SELECT struct_insert(named_struct('a', 1, 'b', 2), 'x', 'hello');
   -- 结果：{"a":1, "b": 2, "x":"hello"}
   ```

2. 向结构体头部插入新字段：
   ```sql
   SELECT struct_insert(named_struct('a', 1, 'b', 2), 'x', 'hello', 0);
   -- 结果：{"x":"hello", "a":1, "b": 2}
   ```

3. 在第一个字段之后插入新字段：
   ```sql
   SELECT struct_insert(named_struct('a', 1, 'b', 2), 'x', 'hello', 1);
   -- 结果：{"a":1, "x":"hello", "b": 2}
   ```

4. 在第二个字段之前插入新字段：
   ```sql
   SELECT struct_insert(named_struct('a', 1, 'b', 2), 'y', 3, 2);
   -- 结果：{"a":1, "y":3, "b": 2, "x": "hello"}
   ```

5. 向包含嵌套结构体的结构体中插入新字段：
   ```sql
   SELECT struct_insert(named_struct('outer', named_struct('inner', 'value')), 'newField', 'newValue');
   -- 结果：{"outer":{"inner":{"value"},"newField":"newValue"}}
   ```

### 注意事项
- 请确保 `name` 参数为字符串常量，否则可能导致函数执行失败。
- `indexToInsert` 参数的有效范围为 0 到结构体字段数量（包含）。超出此范围的值将导致函数执行失败。
- 当插入位置与现有字段冲突时（例如，尝试在已存在的字段位置插入新字段），函数将返回错误。
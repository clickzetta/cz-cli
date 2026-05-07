### JSON_EXTRACT 函数系列

#### 简介
JSON_EXTRACT 函数系列旨在从 JSON 格式的数据中提取特定元素。这些函数根据提供的 JSON 路径（json_path）从 JSON 对象或数组中提取信息，并将结果返回为相应的数据类型。当指定的元素不存在时，函数返回 NULL。

#### JSON 路径规范
JSON 路径是一种简洁的查询语法，用于访问 JSON 数据结构中的元素。以下是一些常用的 JSON 路径符号：

- `$`：表示根元素。
- `.key` 或 `[key]`：用于查找 JSON 对象中的键（key）。特别地，`[*]` 表示获取所有键对应的值。
- `[index]`：用于根据索引（index）访问 JSON 数组的元素，索引从 0 开始。特别地，`[*]` 表示获取数组中的所有元素。

#### 函数列表
- `json_extract(json, json_path)`：从 JSON 数据中提取指定的元素，并返回 JSON 格式的结果。
- `json_extract_boolean(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为布尔值（BOOLEAN）。
- `json_extract_int(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为整数（INT）。
- `json_extract_bigint(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为大整数（BIGINT）。
- `json_extract_float(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为浮点数（FLOAT）。
- `json_extract_double(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为双精度浮点数（DOUBLE）。
- `json_extract_string(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为字符串（STRING）。
- `json_extract_date(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为日期（DATE）。
- `json_extract_timestamp(json, json_path)`：从 JSON 数据中提取指定的元素，并将其转换为时间戳（TIMESTAMP）。

#### 参数说明
- `json`：要处理的 JSON 类型数据。
- `json_path`：用于指定要提取元素的 JSON 路径的字符串。

#### 返回结果
- 对于 `json_extract_json` 函数，返回提取到的 JSON 格式数据。
- 对于其他函数（如 `json_extract_boolean` 等），返回提取到的数据转换为指定数据类型的值。

#### 使用示例
1. 提取 JSON 对象中的嵌套元素：
   ```sql
   SELECT json_extract(json'{"a": {"b": 1}}', '$.a');
   -- 输出：{"b":1}
   ```

2. 提取 JSON 对象中带有点的键：
   ```sql
   SELECT json_extract(json'{"key": 1, "key.with.dot": 2}', '$.key'),
         json_extract(json'{"key": 1, "key.with.dot": 2}', "$['key.with.dot']");
   -- 输出：1       2
   ```

3. 提取 JSON 数组中的所有元素：
   ```sql
   SELECT json_extract(json'[1, 2, 3]', '$[*]');
   -- 输出：[1,2,3]
   ```

4. 将提取到的 JSON 元素转换为整数：
   ```sql
   SELECT json_extract_int(json'{"a": {"b": 1}}', '$.a.b');
   -- 输出：1
   ```

5. 将提取到的 JSON 元素转换为布尔值：
   ```sql
   SELECT json_extract_boolean(json'{"a": {"b": 1}}', '$.a.b');
   -- 输出：true
   ```

通过以上示例，您可以更深入地了解 JSON_EXTRACT 函数系列的使用方法和功能。这些函数为您提供了灵活且高效的方式来处理和分析 JSON 数据。
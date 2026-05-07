## JSON Schema提取函数

### 功能描述

`schema_of_json` 函数用于从给定的 JSON 字符串中解析并生成对应的 DDL schema。该函数可以帮助用户快速理解 JSON 数据的结构，便于后续的数据操作和处理。

### 语法格式

```
schema_of_json(str)
```

### 参数说明

- `str`: 需要解析的 JSON 格式字符串。

### 返回结果

- 返回一个表示 JSON 数据结构的字符串，格式为 DDL schema。

### 使用示例

以下是一个使用 `schema_of_json` 函数的示例：

```sql
SELECT schema_of_json(' {
  "n": null,
  "s": "hello",
  "i": 123,
  "f": 123.0,
  "a": [ null, 123 ],
  "m": {},
  "st": {"a": "s"}
} ');
```

函数返回结果：

```
struct<n:null,s:string,i:bigint,f:double,a:array<bigint>,m:map<string,string>,st:struct<a:string>>
```

### 更多示例

1. 从包含日期的 JSON 字符串中提取 schema：

   ```sql
   SELECT schema_of_json(' {
     "name": "John",
     "age": 30,
     "birthdate": "1991-01-22"
   } ');
   ```

   返回结果：

   ```
   struct<name:string,age:bigint,birthdate:date>
   ```

2. 从嵌套的 JSON 字符串中提取 schema：

   ```sql
   SELECT schema_of_json(' {
     "company": "Example Inc.",
     "employees": [
       {"name": "Alice", "position": "Developer"},
       {"name": "Bob", "position": "Manager"}
     ]
   } ');
   ```

   返回结果：

   ```
   struct<company:string,employees:array<struct<name:string,position:string>>>
   ```

通过以上示例，您可以看到 `schema_of_json` 函数可以灵活地处理各种 JSON 数据结构，并生成相应的 DDL schema。这使得用户能够更轻松地理解和操作 JSON 数据。
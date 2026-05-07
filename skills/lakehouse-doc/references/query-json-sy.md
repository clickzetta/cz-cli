本文旨在指导用户如何利用 SQL 语法高效地查询 JSON 类型的数据。通过掌握这些查询方法，用户能够简化查询流程。JSON 类型的创建请参考文档 [JSON类型](<JSON.md>)。

## **语法**

```SQL
--键名访问JSON对象中的字段
json_column['key']['key']...
--通过索引访问JSON数组中的元素
json_array[index]
```

**参数说明**

* `json_column`：表示一个 JSON 字段，其类型为 JSON 对象。通过键名（`key`，指定为字符串）来定位并检索 JSON 对象内的特定数据字段。使用单个方括号 `[]` 可以访问对象的一级字段；而嵌套使用双方括号 `[][]` 则能够深入检索对象的二级或更深层次的字段。
* `json_array`：表示数组类型的 JSON 字段，用于根据索引（index）访问 JSON 数组的元素，索引起始值为 0。

**返回值说明**
- 返回值为 JSON 类型。如需其他类型，可使用 CAST 函数进行强制转换。类型转换请参考 [JSON类型](<JSON.md>) 文档。

## **案例**

### 取出JSON一级结构

```SQL
SELECT parse_json(s)['firstName'] as j
      FROM VALUES ('{ "firstName": "John", "lastName": "doe", "age": 26, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [] } ] }'),
                  ('{ "firstName": "Ada", "lastName": "doe", "age": 20, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "address2": {"city": "NewYork"}, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [1,2,3] } ] }')
                 as t(s);
```

### 取出JSON二级结构

```SQL
SELECT parse_json(s)['address']['streetAddress'] as j
      FROM VALUES ('{ "firstName": "John", "lastName": "doe", "age": 26, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [] } ] }'),
                  ('{ "firstName": "Ada", "lastName": "doe", "age": 20, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "address2": {"city": "NewYork"}, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [1,2,3] } ] }')
                 as t(s);
```

### 取出JSON数组中的元素

```SQL
SELECT parse_json(s)['phoneNumbers'][0]['number'] as j
      FROM VALUES ('{ "firstName": "John", "lastName": "doe", "age": 26, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [] } ] }'),
                  ('{ "firstName": "Ada", "lastName": "doe", "age": 20, "address": { "streetAddress": "naist street", "city": "Nara", "postalCode": "630-0192" }, "address2": {"city": "NewYork"}, "phoneNumbers": [ { "type": "iPhone", "number": "0123-4567-8888" }, { "type": "home", "number": "0123-4567-8910", "extra": [1,2,3] } ] }')
                 as t(s);
```

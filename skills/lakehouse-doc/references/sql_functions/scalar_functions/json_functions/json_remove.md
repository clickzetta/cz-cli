
###  JSON_REMOVE
``` sql
json_remove(jsonObj, jsonPath)
```
#### 功能
将满足jsonPath的元素从jsonObject中删除，返回剩余的元素
* jsonPath 不支持通配符
* 如果jsonPath不存在，则返回原始jsonObj

#### 参数
* jsonObj: json
* jsonPath: string

#### 返回结果
* json

#### 举例
```sql
> select parse_json(j), json_remove(parse_json(j), '$.b'), json_remove(parse_json(j), '$.b.c')
  from values
  ('{}'),
  ('{"a":1}'),
  ('{"a":2, "b":"y"}'),
  ('{"a":3, "b":{"c":"x"}}'),
  ('{"b":"y"}'),
  (null),
  ('{"c":3}')
  as t(j);
{}      {}      {}
{"a":1} {"a":1} {"a":1}
{"a":2,"b":"y"} {"a":2} {"a":2,"b":"y"}
{"a":3,"b":{"c":"x"}}   {"a":3} {"a":3,"b":{}}
{"b":"y"}       {}      {"b":"y"}
NULL    NULL    NULL
{"c":3} {"c":3} {"c":3}

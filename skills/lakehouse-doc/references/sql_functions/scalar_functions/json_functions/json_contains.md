###  JSON_CONTAINS
``` sql
json_contains(target, candidate)
json_contains(target, candidate, jsonPath)
```

#### 功能
检查 target JSON 对象/数组是否包含 candidate JSON 对象/数组。

**两参数版本：**检查 target 是否包含 candidate
- 对于标量值（字符串、数字、布尔值、null）：检查是否完全相等
- 对于对象：检查 candidate 的所有键值对是否都存在于 target 中（target 可以有额外的键）
- 对于数组：检查 candidate 的所有元素是否都能在 target 中找到（顺序无关）

**三参数版本：**在 target 的指定 jsonPath 位置检查是否包含 candidate
- jsonPath 必须是字符串字面量
- 先按 jsonPath 从 target 中提取元素，再检查该元素是否包含 candidate

#### 参数
* target: json - 目标 JSON 对象
* candidate: json - 待检查的候选 JSON 对象
* jsonPath: string (可选) - JSON 路径，必须是字面量

#### 返回结果
* boolean - 如果包含返回 true，否则返回 false；如果任一参数为 NULL，返回 NULL

#### 举例
```sql
-- 对象包含检查
> select target, candidate, json_contains(json_parse(target), json_parse(candidate)) as contains
  from values
  ('{"a":1,"b":2}', '{"a":1,"b":2}'),              -- 完全匹配
  ('{"a":1,"b":2}', '{"b":2,"a":1}'),              -- 顺序不同，内容相同
  ('{"a":1,"b":2,"c":3}', '{"a":1}'),              -- target 包含 candidate
  ('{"a":1,"b":2,"c":3}', '{"a":1,"b":2}'),        -- target 包含 candidate 的多个键
  ('{"a":1,"b":2}', '{"a":1,"b":2,"c":3}'),        -- target 缺少键
  ('{"a":{"b":1,"c":2}}', '{"a":{"b":1}}'),        -- 嵌套对象
  ('{"a":1}', '{}')                                -- 空对象总是被包含
  as t(target, candidate);
{"a":1,"b":2}	{"a":1,"b":2}	true
{"a":1,"b":2}	{"b":2,"a":1}	true
{"a":1,"b":2,"c":3}	{"a":1}	true
{"a":1,"b":2,"c":3}	{"a":1,"b":2}	true
{"a":1,"b":2}	{"a":1,"b":2,"c":3}	false
{"a":{"b":1,"c":2}}	{"a":{"b":1}}	true
{"a":1}	{}	true

-- 数组包含检查
> select target, candidate, json_contains(json_parse(target), json_parse(candidate)) as contains
  from values
  ('[1,2,3]', '[1,2,3]'),                          -- 完全匹配
  ('[1,2,3,4,5]', '[1,3,5]'),                      -- 包含所有元素（顺序无关）
  ('[1,2,3]', '1'),                                 -- 包含单个值
  ('[1,2,3]', '[1,2,3,4]'),                        -- candidate 有额外元素
  ('[[1,2],[3,4]]', '[[1,2]]'),                    -- 嵌套数组（完全匹配）
  ('[]', '[]')                                      -- 空数组
  as t(target, candidate);
[1,2,3]	[1,2,3]	true
[1,2,3,4,5]	[1,3,5]	true
[1,2,3]	1	true
[1,2,3]	[1,2,3,4]	false
[[1,2],[3,4]]	[[1,2]]	true
[]	[]	true

-- 数组包含对象（分布式包含）
> select target, candidate, json_contains(json_parse(target), json_parse(candidate)) as contains
  from values
  ('[{"a":1},{"b":2}]', '{"a":1}'),                -- 数组包含完整对象元素
  ('[{"a":1},{"b":2}]', '{"a":1,"b":2}')           -- 对象字段分布在数组的多个元素中
  as t(target, candidate);
[{"a":1},{"b":2}]	{"a":1}	true
[{"a":1},{"b":2}]	{"a":1,"b":2}	true

-- 三参数版本：指定路径的包含检查
> select target, candidate,
         json_contains(json_parse(target), json_parse(candidate), '$.a') as contains_at_a,
         json_contains(json_parse(target), json_parse(candidate), '$.c') as contains_at_c
  from values
  ('{"a": 1, "b": 2, "c": {"d": 4}}', '1'),
  ('{"a": 1, "b": 2, "c": {"d": 4}}', '{"d": 4}')
  as t(target, candidate);
{"a": 1, "b": 2, "c": {"d": 4}}	1	true	false
{"a": 1, "b": 2, "c": {"d": 4}}	{"d": 4}	false	true

```


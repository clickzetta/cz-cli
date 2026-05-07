### IS_NOT_NULL 函数

```sql
is_not_null(expr)
```
#### 功能描述
IS_NOT_NULL 函数用于检查给定的表达式（expr）是否不为 NULL。如果表达式非 NULL，函数返回 true，否则返回 false。该函数的作用与 SQL 语句中的 `IS NOT NULL` 条件相同。

#### 参数说明
- `expr`: 任意类型的表达式，用于检查其值是否为 NULL。

#### 返回结果
返回一个布尔值，当 expr 不为 NULL 时返回 true，否则返回 false。

#### 使用示例

1. 检查数字是否非 NULL
```sql
SELECT is_not_null(1);       -- 返回 true
SELECT is_not_null(NULL);     -- 返回 false
```

2. 检查字符串是否非 NULL
```sql
SELECT is_not_null('hello');  -- 返回 true
SELECT is_not_null('');       -- 返回 false
```

3. 检查日期是否非 NULL
```sql
SELECT is_not_null('2022-01-01');  -- 返回 true
SELECT is_not_null(NULL);          -- 返回 false
```

4. 在查询中使用 IS_NOT_NULL 过滤非 NULL 记录
```sql
SELECT id, name, age
FROM users
WHERE is_not_null(age);            -- 只返回 age 字段非 null 的记录
```

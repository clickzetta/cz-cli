### RAISE_ERROR 函数

```
raise_error(message)
```

#### 功能描述

`RAISE_ERROR` 函数用于在查询执行过程中抛出一个运行时错误并中止查询。该函数接受一个错误消息字符串作为参数，当函数被执行时会抛出异常并显示指定的错误消息。通常与 `IF` 函数结合使用，用于在满足特定条件时终止查询执行。

#### 参数说明

* `message`：`STRING` 类型，错误消息内容。如果参数为 `NULL`，则显示 "null message"。

#### 返回类型

* 该函数不返回正常值。
* 执行时会抛出异常并中止查询。
* 错误消息中包含传入的 `message` 参数。

#### 注意事项

* 该函数会中止查询执行，应谨慎使用。
* 在生产环境中使用时应确保只在必要的验证场景下触发。
* 错误消息应清晰明确，便于问题排查。
* `NULL` 参数会显示 "null message"，应避免传入 `NULL`。

#### 使用示例

1. 与 IF 结合使用：条件错误检查

```sql
SELECT IF(COUNT(*) > 0, raise_error('error_result'), 6666)
FROM (SELECT 1 WHERE 1 = 0);
+---------------------------------------------------------+
| IF(COUNT(*) > 0, raise_error('error_result'), 6666)     |
+---------------------------------------------------------+
| 6666                                                    |
+---------------------------------------------------------+
```

2. 在 CASE WHEN 中使用

```sql
SELECT
  CASE
    WHEN status = 'active' THEN 'Active'
    WHEN status = 'inactive' THEN 'Inactive'
    ELSE raise_error('Unknown status: ' || status)
  END as status_label
FROM user_status;
```

### CURRENT_SESSION_ID 函数

```
current_session_id()
```

#### 功能描述

`CURRENT_SESSION_ID` 函数用于返回当前会话的 Session ID。

#### 参数说明

* 无参数。

#### 返回类型

* 返回 `STRING` 类型的字符串，表示当前会话的 Session ID。

#### 使用示例

1. 获取当前会话 ID

```sql
SELECT current_session_id();
+--------------------------------------+
| current_session_id()                 |
+--------------------------------------+
| 18ae19ca-8789-4029-93bd-512c6aebd3fa |
+--------------------------------------+
```

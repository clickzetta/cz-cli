### CURRENT_SCHEMA 函数

#### 功能描述
`CURRENT_SCHEMA` 函数用于获取当前会话正在使用的 `schema` 名称。该函数无需传入任何参数,返回值为字符串类型,表示当前会话的 `schema` 名称。

#### 使用场景
- 当需要根据当前会话的 `schema` 动态执行 `SQL` 语句时。
- 在多 `schema` 环境下,用于判断当前会话所处的 `schema`。

#### 返回结果
`CURRENT_SCHEMA` 函数返回一个字符串,表示当前会话的 `schema` 名称。

#### 使用示例

**示例 1：获取当前 schema**
```sql
SELECT CURRENT_SCHEMA();
```
执行该语句后,如果当前会话使用的是默认 `schema`,则返回 "default"。

**示例 2：切换 schema 后获取当前 schema**
```sql
-- 切换到指定 schema
USE SCHEMA schema1;

-- 获取当前 schema
SELECT CURRENT_SCHEMA();
```
执行该语句后,返回 "schema1",表示当前会话已经切换到 "schema1"。

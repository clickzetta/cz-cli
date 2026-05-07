### CURRENT_WORKSPACE 函数

#### 功能描述
`CURRENT_WORKSPACE` 函数用于获取当前数据库会话所连接的 `workspace` 名称。该函数不需要任何参数,返回值为字符串类型,表示当前会话所操作的 `workspace` 名称。

#### 使用场景
在多 `workspace` 环境下,可以通过 `CURRENT_WORKSPACE` 函数快速获取当前会话所在的 `workspace`,从而进行相关操作,如权限管理、数据隔离等。

#### 示例
以下是使用 `CURRENT_WORKSPACE` 函数的示例：

1. 查询当前会话所在的 workspace 名称：
```sql
SELECT current_workspace();
```
执行结果：
```
"default"
```

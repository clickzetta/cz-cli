### CURRENT_INSTANCE_ID 函数

#### 功能描述
`CURRENT_INSTANCE_ID()` 函数用于获取当前会话所关联的实例（`instance`）的唯一标识符（`ID`）。该函数在分布式数据库系统中尤为重要,因为它可以帮助用户识别和追踪当前操作所处的实例。

#### 使用方法
`CURRENT_INSTANCE_ID()` 函数无需任何参数输入,直接调用即可。返回值是一个整数（`INT`）,表示当前会话关联的实例的`ID`。

#### 示例
以下是几个使用 `CURRENT_INSTANCE_ID()` 函数的示例：

1. 在查询过程中获取当前实例ID：
   ```sql
   SELECT current_instance_id();
   ```
   执行上述查询后,将返回当前会话所关联的实例`ID`,例如：`123`。

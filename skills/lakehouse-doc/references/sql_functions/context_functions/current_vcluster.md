### current_vcluster 函数

#### 功能描述
`current_vcluster` 函数用于获取当前会话所使用的计算集群名称。该函数无需传入任何参数,返回值为字符串类型,表示当前会话正在使用的计算集群。

#### 使用场景
在多计算集群的环境中,了解当前会话所使用的计算集群对于管理和优化资源分配具有重要意义。通过使用 `current_vcluster` 函数,用户可以轻松地查询和切换当前会话所使用的计算集群。

#### 示例
以下是 `current_vcluster` 函数的使用示例：

1. 查询当前会话所使用的计算集群：
```sql
SELECT current_vcluster();
```
执行上述查询后,返回结果可能如下：
```
default
```

2. 切换计算集群并查询：
```sql
USE VCLUSTER test; -- 切换至名为test的计算集群
SELECT current_vcluster();
```
执行上述查询后,返回结果可能如下：
```
test
```

3. 在不同的计算集群之间切换,并观察 `current_vcluster` 函数的返回值：
```sql
-- 切换至名为dev的计算集群
USE VCLUSTER dev;
SELECT current_vcluster();

-- 切换回默认计算集群
USE VCLUSTER default;
SELECT current_vcluster();
```

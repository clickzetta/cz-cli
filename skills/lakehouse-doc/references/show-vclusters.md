## 功能

本命令用于查询当前工作空间下所有计算集群的详细信息。

## 语法

```SQL
SHOW VCLUSTERS [LIKE PATTERN | WHERE expr] [LIMIT num]
```

## 参数说明

1. `LIKE PATTERN`（可选）：通过对象名称进行过滤。可以使用 SQL 通配符 `%` 和 `_`。例如，`LIKE '%testing%'`。注意，`LIKE` 子句不能与 `WHERE` 子句同时使用。

2. `WHERE expr`（可选）：根据特定属性对计算集群进行条件过滤，支持以下属性：

- `vcluster_size`：计算集群规格代码，如 `XSMALL`、`SMALL` 等，使用大写字母。
- `vcluster_type`：计算集群类型，如 `ANALYTICS`、`GENERAL`，使用大写字母。
- `max_concurrency`：根据并发数进行过滤，输入数字。
- `state`：计算集群状态，如 `RESUMING`、`SUSPENDED` 等，使用大写字母。
- `creator`：创建计算集群的用户名称，使用小写字母。
- `create_time`：创建时间，格式为 `"yyyy-MM-dd HH:mm:ss"`，以字符串方式存储，支持比较运算符。
- `min_replicas`：计算实例的最小数量，输入数字。
- `max_replicas`：计算实例的最大数量，输入数字。
- `preload_table`：缓存中的表名称列表，以字符串方式存储，可以使用 `LIKE` 子句匹配特定表名。
- `current_replicas`：计算集群当前的计算实例数量，输入数字。
- `auto_suspend_in_second`：计算集群自动暂停的秒数，输入数字。

## 使用示例

1. 查询当前工作空间下的所有计算集群：

   ```SQL
   SHOW VCLUSTERS;
   ```

2. 查询当前工作空间下，名称前两个字母为“CZ”的计算集群：

   ```SQL
   SHOW VCLUSTERS LIKE 'CZ%';
   ```

3. 使用 WHERE 子句过滤计算集群结果列表：

   ```SQL
   SHOW VCLUSTERS WHERE vcluster_type = 'GENERAL';
   SHOW VCLUSTERS WHERE vcluster_size = 'SMALL';
   SHOW VCLUSTERS WHERE max_concurrency = 8;
   SHOW VCLUSTERS WHERE state = 'SUSPENDED';
   SHOW VCLUSTERS WHERE createor = 'demo_project';
   SHOW VCLUSTERS WHERE create_time > '2024-01-25';
   SHOW VCLUSTERS WHERE min_replicas = 1;
   SHOW VCLUSTERS WHERE max_replicas = 2;
   SHOW VCLUSTERS WHERE preload_tables LIKE '%sample_schema.sample_table%';
   SHOW VCLUSTERS WHERE current_replicas = 3;
   SHOW VCLUSTERS WHERE auto_suspend_in_second = 600;
   ```

通过以上示例，您可以根据需要灵活地查询和过滤计算集群信息。请确保在使用 `WHERE` 子句时，正确使用大小写和运算符，以获得准确的查询结果。
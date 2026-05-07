
# USE 语句

指定用于当前会话的 SCHEMA 和计算资源。


## 语法

```SQL
-- 切换 schema
USE [SCHEMA] schema_name;
-- 切换计算资源
USE VCLUSTER vc_name;
```

## 参数说明

1. `SCHEMA`：这是一个可选关键字，可以在语句中省略。
2. `schema_name`：指定要切换的 schema 名称。

## 使用示例

1. 切换到名为 `ods_schema` 的 schema：

   ```SQL
   USE ods_schema;
   -- 查询当前的 SCHEMA
   SELECT CURRENT_SCHEMA();
   ```

2. 假设当前工作空间中存在名为 `sample_vc` 的计算集群，您可以使用以下命令切换到该计算集群：

   ```SQL
   USE VCLUSTER sample_vc;
   -- 查询当前的计算资源
   SELECT CURRENT_VCLUSTER();
   ```

3. 如果您想要切换到名为 `high_performance_vc` 的计算集群，您可以执行以下命令：

   ```SQL
   USE VCLUSTER high_performance_vc;
   ```

## 使用注意事项

- 在使用客户端工具（如 [客户端 SQLLine](<connect-with-cli.md>)、[DBeaver](<eco_integration/dbeaver-lakehouse.md>) 等）连接时，相关操作会在整个会话期间生效。
- 如果您使用 Lakehouse Studio 界面，建议优先通过页面来切换 schema 和计算集群。如果直接使用命令切换，其效果仅临时生效，且需要和要执行的 SQL 语句一起选中执行方可生效。
![](.topwrite/assets/image_1741317824124.png)


# USE 语句

指定用于当前会话的计算资源。


## 语法

```SQL
--切换计算资源
USE VCLUSTER vc_name;
```

## 参数说明

1. `VCLUSTER`：必填关键字。
2. `vc_name`：指定要切换的计算资源的名称。

## 使用示例

1. 假设当前工作空间中存在名为sample_vc的计算集群，您可以使用以下命令切换到该计算集群：

   ```SQL
   USE VCLUSTER sample_vc;
    --查询当前的计算资源
    SELECT CURRENT_VCLUSTER();
   ```

2. 如果您想要切换到名为high_performance_vc的计算集群，您可以执行以下命令：

   ```SQL
   USE VCLUSTER high_performance_vc;
   ```


## 注意事项
- 在使用客户端工具（如[客户端SQLLine](<connect-with-cli.md>)、[DBeaver](<eco_integration/dbeaver-lakehouse.md>)等）连接时，相关操作会在整个会话期间生效。而如果您使用 Lakehouse Studio 界面，建议优先通过页面来切换 Schema 和计算集群。需要说明的是，若直接使用相关命令，其效果仅临时生效，且需要和要执行的 SQL 语句一起选中执行方可生效。
![](.topwrite/assets/image_1741317824124.png)
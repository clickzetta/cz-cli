# 删除计算集群

## 功能

删除指定的计算集群。计算集群删除后将不可恢复，请谨慎操作。

## 语法

```SQL
DROP VCLUSTER [IF EXISTS] NAME [FORCE];
```

- `IF EXISTS`：可选关键字，用于判断计算集群是否存在。如果存在，则执行删除操作；如果不存在，则不执行删除操作且不报错。
- `NAME`：指定要删除的计算资源名称。
- `FORCE`：可选关键字，用于强制删除计算资源。如果不添加FORCE关键字，计算集群将在当前作业执行完毕后再进行删除。如果加入FORCE关键字，计算集群将直接删除，不再等待当前执行作业完成。

## 示例

1. 删除空间内名称为`sample_vc`的计算资源：

   ```SQL
   DROP VCLUSTER sample_vc;
   ```

2. 强制删除空间内名称为`simple_vc`的计算资源：

   ```SQL
   DROP VCLUSTER sample_vc FORCE;
   ```

3. 删除空间内名称为`test_vc`的计算资源，如果该计算集群不存在，则不执行删除操作且不报错：

   ```SQL
   DROP VCLUSTER IF EXISTS test_vc;
   ```

4. 删除空间内名称为`production_vc`的计算资源，使用FORCE关键字强制删除：

   ```SQL
   DROP VCLUSTER production_vc FORCE;
   ```

5. 在删除计算资源时，先判断计算资源是否存在：如果存在则删除，如果不存在则不报错：

   ```SQL
   DROP VCLUSTER IF EXISTS development_vc;
   ```

## 注意事项

- 在执行删除操作前，请确保计算集群内没有正在运行的作业，以免造成数据丢失或任务失败。
- 使用FORCE关键字强制删除计算集群时，请确保当前没有作业正在执行，否则可能会导致正在执行的作业中断或失败。
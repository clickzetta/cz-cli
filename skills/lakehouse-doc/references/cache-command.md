## 功能介绍

`CACHE TABLE` 命令允许用户通过 SQL 语句在 AP VC 启动阶段或在执行 Adhoc 查询时，将冷数据提前加载到 VCluster 中，从而提高查询速度。目前，此功能仅适用于 ANALYTICAL VCLUSTER。

## 语法

```
CACHE TABLE table_name;
```

## 参数说明

- `table_name`: 指定需要缓存的表名。

## 使用示例

1. 将指定表临时缓存到 VCluster 中：

   ```
   CACHE TABLE tpc100g.lineitem, nation;
   ```

2. 将多个表临时缓存到 VCluster 中：

   ```
   CACHE TABLE tpc100g.lineitem, tpc100g.nation, tpc100g.region;
   ```

3. 查看当前缓存状态：

   ```
   SHOW CACHED STATUS;
   ```

## 注意事项

- 确保在执行 `CACHE TABLE` 命令时，已正确指定表名。



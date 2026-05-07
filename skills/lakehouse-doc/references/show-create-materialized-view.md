## 功能
`SHOW CREATE MATERIALIZED VIEW`命令Lakehouse使用`SHOW CREATE TABLE`来代替。`SHOW CREATE TABLE`命令用于获取指定表、外部表、物化视图、动态表或视图的创建语句。
## 语法

```
SHOW CREATE TABLE object_name;
```

**参数说明**

* `object_name`：指定要查询的数据库对象名称。这可以是表、外部表、物化视图、动态表或视图。

## 使用示例


**1. 查看物化视图的创建语句**

如果要查看名为 `mv` 的物化视图的创建语句，可以使用以下命令：

```
SHOW CREATE TABLE mv;
```

系统将返回类似于以下的输出结果：

```
+--------------------------------------------------------+
|                          sql                           |
+--------------------------------------------------------+
| CREATE MATERIALIZED VIEW qingyun.`public`.mv(
  `i` ,
  `j` )
REFRESH ON DEMAND
USING PARQUET
OPTIONS(
  'cz.storage.parquet.block.size'='134217728',
  'cz.storage.parquet.dictionary.page.size'='20971 |
+--------------------------------------------------------+
```





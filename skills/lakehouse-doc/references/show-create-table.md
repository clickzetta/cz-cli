## 功能

`SHOW CREATE TABLE` 命令用于获取指定表、物化视图或视图的创建语句。通过这个命令，用户可以方便地查看和复制已有数据库对象的创建语句。

## 语法

```
SHOW CREATE TABLE object_name;
```

**参数说明**

* `object_name`：指定要查询的数据库对象名称。这可以是表、物化视图或视图。

## 使用示例

**1. 查看表的创建语句**

要查看名为 `dy_base_a` 的表的创建语句，可以执行以下命令：

```
SHOW CREATE TABLE dy_base_a;
```

执行该命令后，系统将返回类似于以下的输出结果：

```
+--------------------------------------------------------+
|                          sql                           |
+--------------------------------------------------------+
| CREATE TABLE wb.`public`.dy_base_a(                    |
|   `i` int,                                             |
|   `j` int)                                             |
| USING PARQUET                                          |
| OPTIONS(                                               |
|   'cz.storage.parquet.block.size'='134217728',         |
|   'cz.storage.parquet.dictionary.page.size'='2097152') |
+--------------------------------------------------------+
```

**2. 查看物化视图的创建语句**

如果要查看名为 `mv` 的物化视图的创建语句，可以使用以下命令：

```
SHOW CREATE TABLE mv;
```

系统将返回类似于以下的输出结果：

```
+--------------------------------------------------------+
|                          sql                           |
+--------------------------------------------------------+
| CREATE MATERIALIZED VIEW qingyun.`public`.mv(          |
|   `i`,                                                 |
|   `j`)                                                 |
| REFRESH ON DEMAND                                      |
| USING PARQUET                                          |
| OPTIONS(                                               |
|   'cz.storage.parquet.block.size'='134217728',         |
|   'cz.storage.parquet.dictionary.page.size'='2097152') |
+--------------------------------------------------------+
```

**3. 查看视图的创建语句**

要查看名为 `v0` 的视图的创建语句，可以执行以下命令：

```
SHOW CREATE TABLE v0;
```

系统将返回类似于以下的输出结果：

```
CREATE VIEW `v0` AS
SELECT t1.id, t1.name
FROM table1 AS t1
WHERE t1.age > 18;
```

**4. 查看动态表的创建语句**

如果要查看名为 `change_table` 的动态表的创建语句，可以使用以下命令：

```
SHOW CREATE TABLE change_table;
```

系统将返回类似于以下的输出结果：

```
+--------------------------------------------------------+
|                          sql                           |
+--------------------------------------------------------+
| CREATE DYNAMIC TABLE wb.`public`.change_table(         |
|   `i`,                                                 |
|   `j`)                                                 |
| REFRESH ON DEMAND                                      |
| USING PARQUET                                          |
| OPTIONS(                                               |
|   'cz.storage.parquet.block.size'='134217728',         |
|   'cz.storage.parquet.dictionary.page.size'='2097152') |
+--------------------------------------------------------+
1 row selected (0.118 seconds)
```

## 功能

SHOW CREATE EXTERNAL TABLE命令Lakehouse使用`SHOW CREATE TABLE`来代替。`SHOW CREATE TABLE`命令用于获取指定表、外部表、物化视图、动态表或视图的创建语句。


## 语法

```
SHOW CREATE TABLE object_name;
```

**参数说明**

* `object_name`：指定要查询的数据库对象名称。这可以是表、外部表、物化视图、动态表或视图。

## 使用示例

**1. 查看表的创建语句**

要查看名为 `t0` 的表的创建语句，可以执行以下命令：

```
SHOW CREATE TABLE new_pepole_delta;
```

执行该命令后，系统将返回类似于以下的输出结果：

```
+-----------------------------------------------------------------+
|                               sql                               |
+-----------------------------------------------------------------+
| CREATE EXTERNAL TABLE ql_ws.`public`.new_pepole_delta(
  `id` int,
  `name` string,
  `dt` string)
PARTITIONED BY(`dt`)
USING delta
LOCATION "oss://function-compute-my1/delta-format/uploaddelta/"
CONNECTION ql_ws.oss_delta
COMMENT 'new_pepole_delta'; |
+-----------------------------------------------------------------+

```



# 删除 Table Stream 命令

## 功能

删除已经存在的 Table Stream，释放相关资源。

## 语法

```SQL
DROP TABLE STREAM [IF EXISTS] stream_name;
```

* `stream_name`：要删除的Table Stream名称。

## 说明

`DROP TABLE STREAM` 命令用于删除已经存在的Table Stream。如果指定的Table Stream不存在，可以通过添加 `IF EXISTS` 选项来避免出现错误提示。

## 示例

1. 删除名为 `rc3.igs_test_upsert02_stream` 的Table Stream：

```SQL
DROP TABLE STREAM IF EXISTS rc3.igs_test_upsert02_stream;
```

2. 删除名为 `my_stream` 的Table Stream，不关心是否存在：

```SQL
DROP TABLE STREAM my_stream;
```

3. 删除名为 `customer_stream` 的Table Stream，如果存在：

```SQL
DROP TABLE STREAM IF EXISTS customer_stream;
```

## 注意事项

* 删除 Table Stream 前，请确保不再需要该 Stream 中的数据。
* 删除操作无法撤销，请谨慎操作。
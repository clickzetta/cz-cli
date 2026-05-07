## 功能

本命令用于查看 Table Stream 的详细信息，包括创建时间、修改时间、工作空间等。

## 语法

```SQL
DESC[RIBE] TABLE STREAM ts_name;
```

**参数说明**

* **DESC\[RIBE**]：DESC 和 DESCRIBE 可以互换使用，都表示查看的意思。
* **ts\_name**：指定要查看的 Table Stream 名称。

## 使用示例

**示例 1：查看 Table Stream 基本信息**

```SQL
DESC TABLE STREAM event_stream;
```

结果：

```
+--------------------+-------------------------+
|     info_name      |       info_value        |
+--------------------+-------------------------+
| name               | event_stream            |
| creator            |                          |
| created_time       | 2023-11-24 21:44:07.261 |
| last_modified_time | 2023-11-24 21:44:07.265 |
| comment            |                         |
| workspace          | ql_ws                   |
| source_name        | ql_ws.public.event      |
+--------------------+-------------------------+
```

## 注意事项

* 执行该命令前，请确保已创建对应的 Table Stream。



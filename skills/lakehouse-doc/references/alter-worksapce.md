# 修改工作空间属性

在本节中，我们将介绍如何修改工作空间的属性，包括修改工作空间的注释（comment）等。这将帮助您更好地管理和组织您的工作空间。

## 修改工作空间的注释

要修改工作空间的注释，您可以使用以下SQL语句：

```
ALTER WORKSPACE wbname SET COMMENT 'comment';
```

在这里，`wbname`代表您要修改的工作空间名称，而`comment`则是您想要设置的新注释。

## 修改Workspace的PROPERTIES

```SQL
ALTER WORKSPACE wbname SET PROPERTIES ('key'='value')
```

要查看 Workspace PROPERTIES，请使用以下语法：

```SQL
SHOW PROPERTIES IN WORKSPACE <workspace_name>
```

## 案例

**示例：修改工作空间的注释**

假设您有一个名为`ql_ws`的工作空间，您想要为其添加一条注释：“这是一个用于查询的工作环境。”您可以使用以下SQL语句进行修改：

```
ALTER WORKSPACE ql_ws SET COMMENT '这是一个用于查询的工作环境。';
```

执行该语句后，您可以使用 `DESC` 命令查看工作空间的详细信息，确认注释已成功修改：

```
DESC WORKSPACE ql_ws;
```

查询结果将显示类似以下内容：

```
+--------------------+-----------------------------------------+
|     info_name      |               info_value                |
+--------------------+-----------------------------------------+
| name               |                ql_ws                    |
| creator            |               UAT_TEST                   |
| created_time       |          2023-04-18 17:11:01.314      |
| last_modified_time |          2024-01-08 11:33:56.772      |
| comment            | 这是一个用于查询的工作环境。        |
+--------------------+-----------------------------------------+
```

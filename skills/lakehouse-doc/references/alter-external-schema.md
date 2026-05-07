# 修改Schema属性

在本篇文档中，我们将为您介绍如何修改 Schema 的属性，以便更好地满足您的需求。我们将详细说明如何使用 ALTER SCHEMA 命令来设置和修改 Schema 的属性（PROPERTIES），并提供一些常见的使用示例。

## 使用 ALTER SCHEMA 命令修改 Schema 属性

要修改 Schema 的属性，您可以使用以下 ALTER SCHEMA 命令：

```SQL
ALTER SCHEMA scname SET PROPERTIES ('property_key'='property_value');
```

其中，`scname` 是您要修改的 Schema 名称，`property_key` 是要修改的属性键名，`property_value` 是对应的属性值。

## 权限要求

要执行此操作，您需要拥有对应 Schema 的 ALTER 权限。




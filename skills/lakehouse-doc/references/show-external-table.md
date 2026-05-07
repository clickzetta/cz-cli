# 列出外部表命令功能文档

## 功能概述

`SHOW TABLES` 是一个 SQL 命令，用于列出数据库中的所有表。当使用 `WHERE is_external=true` 条件时，此命令将仅列出外部表。

## 语法

### 基本语法

```SQL
SHOW TABLES [IN schema_name] WHERE is_external=true  [LIMIT num];
```

## 参数说明

- **schema_name**: (可选) 要列出其中表的 schema 名称。如果指定，命令将只列出指定 schema 中的外部表。
- **is_external**: 一个布尔值条件，用于筛选外部表。



## 示例

列出当前数据库中所有的外部表。

```SQL
SHOW TABLES WHERE is_external=true;
```

列出 `my_schema` schema 中定义的所有外部表。

```SQL
SHOW TABLES IN my_schema WHERE is_external=true;
```





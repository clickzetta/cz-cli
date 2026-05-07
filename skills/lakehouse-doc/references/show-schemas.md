## 功能概述

`SHOW SCHEMAS` 语句旨在展示当前工作空间（WORKSPACE）中所有模式（SCHEMA）的列表。用户可以通过灵活的过滤条件，根据特定的模式或条件来查看相关的 SCHEMA。此外，使用 `EXTENDED` 关键字可以获取每个 SCHEMA 的更多详细信息，例如其类型（MANAGED 或 EXTERNAL）。

## 语法结构

```Plain
SHOW SCHEMAS [EXTENDED] [LIKE 'pattern' | WHERE expr];
```

## 参数详解

* `LIKE pattern`: 此参数支持通过模式匹配来筛选输出结果。匹配方式不区分大小写，并支持使用 SQL 通配符 `%`（表示任意数量的字符）和 `_`（表示任意单个字符）。例如，`LIKE '%report%'` 会筛选出所有包含 "report" 字符串的 SCHEMA 名称。需要注意的是，`LIKE` 子句与 `WHERE` 子句互斥，不能同时使用。
* `EXTENDED`: 当使用此关键字时，命令将返回包含额外信息的附加列，例如显示 SCHEMA 类型的 `type` 列，
* `WHERE expr`: 此参数允许用户根据 `SHOW SCHEMAS` 命令展示的字段进行更细致的筛选，以便查找符合特定条件的 SCHEMA。

## 使用示例

以下是 `SHOW SCHEMAS` 命令的几个使用示例：

1. 查看当前工作空间下的所有 SCHEMA：

   ```SQL
   SHOW SCHEMAS;
   ```

2. 获取所有 MANAGED 类型的 SCHEMA 及其详细信息：

   ```SQL
   SHOW SCHEMAS EXTENDED WHERE type='managed';
   ```

3. 若需要查找特定的 SCHEMA 名称，可以使用 `WHERE` 子句通过 SCHEMA 名称进行筛选：

   ```SQL
   SHOW SCHEMAS WHERE SCHEMA_NAME='your_schema_name';
   ```

## 权限要求

为了执行 `SHOW SCHEMAS` 命令，用户必须具备对应 SCHEMA 的读取元数据（READ METADATA）权限。

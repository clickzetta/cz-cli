---
name: sql-to-dt
description: 将 Hive/Spark 的 CREATE TABLE DDL + INSERT OVERWRITE SQL 自动转换为 Dynamic Table DDL 及配套文件（refresh、backfill）。当用户提供 DDL 和 INSERT OVERWRITE 要求转换为 DT 时触发。Triggers on: "转换DT", "sql to dt", "convert to dynamic table", "INSERT OVERWRITE 转 DT", "DDL 转换"
---

# SQL → Dynamic Table 自动转换

将传统 Hive/Spark ETL SQL（CREATE TABLE + INSERT OVERWRITE）转换为 Dynamic Table DDL 及配套运维文件。

## 使用方式

提供以下输入：
1. CREATE TABLE DDL（表结构定义）
2. INSERT OVERWRITE SQL（ETL 查询逻辑）

转换工具会自动完成：占位符替换、自引用检测、核心转换、列校验、配套文件生成。

详细工作流参见 `references/sql2dt-workflow.md`

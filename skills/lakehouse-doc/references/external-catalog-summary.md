# 概述
>**【预览发布】本功能当前处于公开预览发布阶段。**

External Catalog 是 Lakehouse 中的一个安全对象，它映射了外部数据系统中的数据库，使得用户可以在 Lakehouse 中对该数据系统执行只读查询。通过 External Catalog，用户可以利用 Lakehouse 的查询能力访问和分析存储在外部数据库中的数据。

# External Catalog使用场景
* **统一元数据管理**：将多个数据源的元数据统一管理，简化数据治理。
* **数据联邦查询**：使用 External Catalog，用户可以在不同的数据源之间进行联合查询，如同它们是同一个数据库内的数据一样。通过联邦查询，用户能够实时访问和分析存储在外部系统中的数据，无需等待数据同步。
* **数据导入**：将分散在不同数据源的数据导入 Lakehouse，构建统一的数据湖，便于进行大数据分析和机器学习。将历史数据或不常访问的数据保留在外部存储中，通过 External Catalog 导入到 Lakehouse，优化数据仓库的存储和性能。

# 使用 External Catalog

1. **创建连接**：首先，需要在 Catalog Connection 中创建一个连接（connection），这个连接是一个安全对象，它指定了用于访问外部数据库系统的路径和认证信息。
2. **创建外部目录**：使用已创建的连接，可以创建一个外部目录（External Catalog）。这个目录在 Lakehouse 中作为安全对象存在，镜像了外部数据系统中的数据库结构。
3. **执行查询**：一旦外部目录被创建，用户就可以在Lakehouse中编写 SQL 查询。

# 支持的数据源

Lakehouse 通过多源数据目录（Multi-Catalog）功能，
- 支持了[Apache Hive连接访问](<create-hive-catalog.md>)
- 支持External Iceberg Rest Catalog,具体参考[利用 External Catalog 访问 Snowflake OpenCatalog 的 Iceberg 表](<Query_SnowflakeOpenCatalog_Icebergtable.md>)
- 支持访问Databricks,具体参考[Databricks-云器Lakehouse 跨平台数据联邦最佳实践指南](<databricks_yunqi_integration_guide_v2.md>)


# EXTERNAL CATALOG相关使用语法
- 创建External Catalog
[参考CREATE EXTERNAL CATALOG](<create-external-catalog.md>)
- 列出 Catalog
[参考SHOW CATALOG](<show-catalog.md>)
- 查看Catalog下的SCHEMA
参考[查看EXTERNAL CATALOG下的SCHEMA](<show-catalog-schema.md>)
- 列出CATALOG下的表
参考[列出CATALOG下的表](<show-catalog-table.md>)
- 查寻CATALOG下的表
参考[查询CATALOG下的表](<show-catalog-table.md>)
- 创建CATALOG下的表结构
参考[查看CATALOG下的表结构](<desc-catalog-table.md>)

# 权限
目前创建的 Catalog 只有 instance admin 角色可以查询。
# 使用案例
[参考创建HIVE CATALOG](<create-hive-catalog.md>)
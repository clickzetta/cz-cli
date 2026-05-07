---
name: lakehouse-doc
description: "云器 Lakehouse 官方文档知识库。编写 SQL、查询语法/函数/数据类型、DDL/DML、动态表、权限、计算组、数据湖、AI 函数等 Lakehouse 相关问题时，必须查阅本 skill 的 references/ 目录。"
---

# lakehouse-doc

云器 Lakehouse 官方文档。根据用户问题在 `references/` 下按文件名定位对应文档。

## references/ 目录结构

```
references/
├── *.md                          # 778 篇主文档（按主题命名，见下方索引）
├── eco_integration/              # 生态工具集成 (12 篇)
│   ├── dbt.md, superset.md, datagrip-lakehouse.md, trino.md ...
├── java_reference/               # Java SDK (5 篇)
│   ├── java-sdk-summary.md, jdbc.md, realtime-upload.md, client.md ...
├── python_reference/             # Python SDK (3 篇)
│   ├── connector.md, sqlalchemy.md, python-sdk-summary.md
├── opensource/                   # 开源工具 (1 篇)
│   └── travel.md
└── sql_functions/                # SQL 函数参考 (339 篇)
    ├── aggregate_functions/      # 聚合函数 (52): count.md, sum.md, avg.md ...
    ├── window_functions/         # 窗口函数 (19): row_number.md, rank.md, lag.md ...
    ├── table_functions/          # 表函数 (9): table_changes.md ...
    ├── context_functions/        # 上下文函数 (8): current_user.md ...
    └── scalar_functions/         # 标量函数 (339)
        ├── datetime_functions/   # 日期时间 (66)
        ├── string_functions/     # 字符串 (70)
        ├── math_functions/       # 数学 (55)
        ├── nested_functions/     # 嵌套类型 (45)
        ├── bitmap_functions/     # Bitmap (29)
        ├── json_functions/       # JSON (14)
        ├── conditional_functions/# 条件 (14)
        ├── high_order_functions/ # 高阶 (12)
        ├── vector_functions/     # 向量 (11)
        ├── ip_functions/         # IP (6)
        ├── search_functions/     # 搜索 (6)
        ├── hash_functions/       # 哈希 (5)
        ├── geo_functions/        # 地理 (3)
        ├── bitwise_functions/    # 位运算 (2)
        └── partition/            # 分区 (1)
```

## 文档索引（llms.txt）

# 云器 Lakehouse 文档（LLM 导航）

> 云器 Lakehouse 是全托管的湖仓一体架构平台，基于云原生设计理念从零打造。通过**存算分离**、**Serverless弹性架构**、**开放存储格式**和**AI优化工具**，为企业提供数据仓库、数据湖、实时处理与BI报表的统一平台。

## 快速入门

- [概览](https://www.yunqi.tech/documents/Overview): 介绍云器Lakehouse的存算分离架构、Serverless计算、开放数据格式及主要应用场景。
- [产品概念](https://www.yunqi.tech/documents/Concepts): 介绍云器Lakehouse的存算分离架构、Serverless计算、开放数据格式及主要应用场景。
- [入门指导](https://www.yunqi.tech/documents/Tutorials): 通过数据导入、SQL查询、数据可视化等步骤，快速完成从数据接入到分析展示的完整流程。

## 使用指南

- [Studio](https://www.yunqi.tech/documents/studio_manual): 通过Web界面进行数据开发与管理，支持连接数据源、SQL查询、作业编排、结果可视化和资产目录浏览。
- [对象模型](https://www.yunqi.tech/documents/object_model_design): 介绍云器Lakehouse的对象模型核心概念，包括目录、数据库、表、视图、物化视图、函数和共享的定义与层级关系。
- [数据采集](https://www.yunqi.tech/documents/Ingestion): 通过本地文件、数据库、Kafka等多种数据源导入数据，涵盖核心概念、配置步骤与操作示例。
- [数据加工](https://www.yunqi.tech/documents/Transformation): 围绕"数据加工"说明核心概念、关键配置与典型操作步骤，并提供示例与注意事项。
- [数据分析](https://www.yunqi.tech/documents/Analysis): 提供从数据导入、SQL查询到可视化分析的全流程操作指南，涵盖数据源连接、SQL语法、函数使用及结果导出。
- [安全](https://www.yunqi.tech/documents/data_security): 提供用户管理、权限控制、审计日志等安全功能。
- [数据分享](https://www.yunqi.tech/documents/data_share): 围绕"数据分享"说明核心概念、关键配置与典型操作步骤。
- [私网连接](https://www.yunqi.tech/documents/connect_to_Lakehouse): 通过配置终端节点实现跨VPC或本地IDC与云上服务的私网安全访问。
- [性能测试](https://www.yunqi.tech/documents/benchmark): 性能测试核心概念、关键配置与典型操作步骤。
- [生态工具](https://www.yunqi.tech/documents/tools): 生态工具核心概念、关键配置与典型操作步骤。
- [Insight](https://www.yunqi.tech/documents/Lakehouse_Insight): 通过连接云器Lakehouse数据源，创建数据集并拖拽生成BI报表与看板。

## SQL手册

- [SQL命令](https://www.yunqi.tech/documents/sql-reference): DDL、DML、DQL等SQL命令的完整语法参考。
- [数据类型](https://www.yunqi.tech/documents/data-type): 精确数值、浮点数、字符串、日期时间、布尔值等数据类型定义。
- [SQL函数](https://www.yunqi.tech/documents/functions): SQL函数核心概念与使用示例。
- [SQL使用指南](https://www.yunqi.tech/documents/considerations-for-using-sql): SQL使用注意事项与最佳实践。

## 开发手册

- [Java SDK 参考](https://www.yunqi.tech/documents/java-sdk-refer): Java SDK 核心概念、关键配置与典型操作步骤。
- [Python SDK 参考](https://www.yunqi.tech/documents/python-sdk-refer): Python SDK 核心概念、关键配置与典型操作步骤。

## 实践教程

- [高效管理对象和组织数据](https://www.yunqi.tech/documents/data_org): 数据对象创建管理，目录组织、权限、生命周期策略。
- [数据导入导出实践](https://www.yunqi.tech/documents/practice_data_import_and_export): 多数据源导入导出操作步骤与示例。
- [数据查询分析实践](https://www.yunqi.tech/documents/practice_data_analysis): 从数据导入到可视化分析的全流程操作指南。
- [构建和运维ELT流程实践](https://www.yunqi.tech/documents/ELT_practice): 企业级ELT流水线构建，涵盖开发、测试、部署及故障恢复。
- [优化计算资源](https://www.yunqi.tech/documents/OptimizingComputingResources): 计算组配置、弹性伸缩策略和资源监控。
- [性能体验](https://www.yunqi.tech/documents/performence_test): 性能测试方法、优化建议与监控指标。
- [构建 Modern Data Stack](https://www.yunqi.tech/documents/ModernDataStackWithEcosystemTools): 现代数据栈核心组件与架构模式。
- [AI应用开发](https://www.yunqi.tech/documents/REMOTEFUNCTION): 从数据准备、模型训练到服务部署的AI应用开发流程。
- [安全与合规审计](https://www.yunqi.tech/documents/security_compliance_audit_guide): 权限管理、SQL审计日志、数据脱敏策略及合规性配置。
- [用量和费用管理](https://www.yunqi.tech/documents/cost_management): 用量明细、费用构成、计费模式与预算管理。

## Lakehouse AI

- [Lakehouse AI 概述](https://www.yunqi.tech/documents/LakehouseAI_overview): 非结构化数据管理、AI外部函数、多模态检索、Python开发框架及对话式分析。
- [AI 的数据准备](https://www.yunqi.tech/documents/Server_data_for_AI): 向量检索、全文搜索与结构化数据分析的无缝结合。
- [AI 函数](https://www.yunqi.tech/documents/AI_function_in_SQL): 创建和使用AI函数，支持Python/Java调用外部AI服务。
- [Zettapark](https://www.yunqi.tech/documents/LakehousePythonZettapark): Python开发框架API参考。
- [AI + BI 统一工作流](https://www.yunqi.tech/documents/unifiedWorkflow): 自然语言交互生成SQL查询与可视化。
- [AI Gateway](https://www.yunqi.tech/documents/AIGateway): 统一接入、路由分发、负载均衡、限流熔断。
- [DataGPT](https://www.yunqi.tech/documents/datagpt_intro): 自然语言提问直接生成SQL并获取可视化图表。
- [Lakehouse MCP Server](https://www.yunqi.tech/documents/LakehouseMCPServer): 通过MCP将数据湖仓能力暴露给AI助手。
- [AI 生态](https://www.yunqi.tech/documents/AI_eco): 与PyTorch、TensorFlow、MLflow、LangChain等集成。

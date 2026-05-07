# Lakehouse Studio 快速导览

本文档可以帮助您快速了解 Lakehouse Studio 提供的核心功能。在 Lakehouse Studio 中，您可以执行数据分析和工程任务，监控查询、数据加载/同步、数据转换和工作流活动，探索您的 Lakehouse 对象，并管理您的 Lakehouse，包括管理成本和添加用户及角色。

> 您可以通过此文档快速了解 Studio 的功能，同时也强烈建议参考[入门指南](Lakehouse_Studio_101.md)系列文档来快速上手。

![](.topwrite/assets/image_1742438525073.png)

^

## Lakehouse Studio 让您可以

* [数据管理](data.md)，创建和管理数据湖/数据库对象，如数据库、表、动态表等。
* [计算资源管理](computation.md)，创建和管理计算资源，如虚拟集群、作业历史记录等。
* [ELT 管道开发与管理](ide.md)，创建和管理数据 ELT 管道对象，如数据源、管道定义、任务（提取任务、转换任务等）、工作流、告警等。任务支持以下类型：
  * [数据同步任务](data-integration.md)，从数据库/数据仓库/数据湖等数据源摄取数据到 Lakehouse，并将数据从 Lakehouse 导出到其他数据源。
  * [SQL 任务](taskdevelop.md)，编写 SQL 查询和代码，用于数据摄取、发现、清洗、转换，并利用工作表中的数据库对象和 SQL 函数的自动完成功能。
  * [Python 任务](Python_Task.md)，构建、测试和部署 SQLAlchemy/Zettapark Python 工作表。
  * [JDBC 任务](jdbc_task.md)，构建、测试和部署 JDBC 工作表（通过 JDBC 连接在数据源中操作数据）。
* [组织任务](taskdevelop.md)，将工作表组织到任务文件夹和[任务组](task_group.md)中。
* **共享作业配置文件**：与其他用户共享作业配置文件。
* **数据探查**：将 SQL 工作表结果可视化为数据探查。
* **管理和控制成本**：管理和控制成本。
* [作业历史记录](web-job-history.md)，查看查询历史记录和数据加载历史记录。
* [工作流 DAG](task-instance-maintenance.md)，查看工作流图和运行历史记录。
* [补数任务](backfilling_data.md)，调试和重新运行任务图。
* **监控动态表**：监控动态表图和刷新情况。
* [用户/角色管理](account_user_management.md)，管理和创建 Lakehouse 用户和角色。
* [数据质量管理](DataQuality.md)，清洗、优化和提升大量数据集，提高其价值密度，从而更有效地满足业务目标。

有关这些任务和其他可执行任务的详细信息，请参阅[Lakehouse Studio: Lakehouse 的 Web 界面](studio_manual.md)。

## 探索和管理您的 Lakehouse 对象

您可以在 Lakehouse Studio 中按照以下方式探索和管理您的数据湖/数据库对象：

* 使用数据对象资源管理器探索数据湖/数据库和对象，包括表、视图等。
* 创建模式、表等对象。
* 在对象资源管理器中搜索，以浏览您账户中的数据库对象。
* 预览数据库对象（如表）的内容，并查看上传到卷中的文件。
* 将文件加载到现有表中，或从文件创建表，以便更快地在 Lakehouse 中开始使用数据。

如需了解更多相关信息，请参阅以下文档：

* [通过数据资产地图搜索数据对象](data_catalog.md)
* [使用 Lakehouse Studio Web 界面加载数据](upload_data.md)

## 数据同步任务

数据同步是 Lakehouse 内置的一种无缝数据集成功能，能够实现多种数据源之间的数据移动。它使用户能够通过强大的调度系统自动执行同步任务。借助此功能，您可以轻松地将数据导入 Lakehouse，导出经过处理的数据，或在不同数据源之间协调数据——无需编写任何代码。整个过程就像通过一个用户友好的向导进行导航一样简单。

根据数据源、数据格式、加载方法以及处理类型（批处理、流处理或数据传输）的不同，将数据加载到 Lakehouse 有多种方式。Lakehouse 提供了多种导入方式，按实现途径分类，包括：通过用户 SDK 导入、通过 SQL 命令导入、通过客户端上传数据、通过第三方开源工具导入以及通过 Lakehouse Studio 可视化界面导入。

### 导入方法概述

![](.topwrite/assets/image_1742463415615.png)

### 支持的数据源

![](.topwrite/assets/image_1742437875252.png)

### 实时多表数据同步任务（CDC）

* 创建数据源（Postgres）
* 创建从 Postgres 到 Lakehouse 的实时多表同步任务
* 提交并操作任务，然后启动任务
* 任务监控与维护（启动、停止、下线）

![](.topwrite/assets/image_1742437920068.png)

有关详细信息，请参阅以下文档：

* [数据源支持](datasources.md)
* [数据源管理](config-datasource.md)
* [批处理数据同步任务](batch_sync.md)
* [多表实时 CDC（变更数据捕获）同步任务](multitable_realtime_sync.md)
* [从 Kafka/AutoMQ 实时数据同步](realtime_sync.md)

## 在工作表和工作流编排中编写 SQL 和 SQLAlchemy/Python 代码

工作表提供了一种简单的方法，用于编写 SQL 作业（DML 和 DDL），查看结果，并将它们作为任务进行调度。借助工作表，您可以执行以下操作：

* 运行即席查询和其他 DDL/DML 操作。
* 在 Python 工作表中编写 SQLAlchemy/Zettapark Python 代码。
* 查看已执行查询的查询历史记录和结果。
* 同时查看多个工作表，每个工作表都有自己独立的会话。
* 在结果仍可用时，导出所选查询语句的结果。
* 提交作业并将其作为任务进行调度。

如果在导航菜单中选择工作表，您将看到工作表列表，并可以选择一个以查看和更新工作表内容。

![](.topwrite/assets/image_1742437938827.png)

有关详细信息，请参阅以下文档：

* [Lakehouse Studio 任务开发概述](task_development.md)
* [使用 Lakehouse Studio 任务开发和调度进行工作流编排](taskdevelop.mds)
* [Lakehouse Studio 任务组](task_group.md)
* [在 Python 工作表中编写 Python 代码](Python_Task.md)

## 将查询结果可视化为数据探查

在 Lakehouse Studio 中运行查询时，您可以选择将结果的数据探查可视化。

![](.topwrite/assets/image_1742437950526.png)

## 共享数据

通过与其他 Lakehouse 账户的用户共享数据，实现协作。在共享数据时，您可以使用自动交付（或自动履行）功能，轻松地在相同的云区域中提供数据。作为数据消费者，您可以访问共享给您的账户的数据集，从而在无需设置数据管道或编写任何代码的情况下，获得实时数据洞察。

![](.topwrite/assets/image_1742437962089.png)

有关详细信息，请参阅以下文档：

* [Lakehouse 数据共享](datasharing.md)

## 在 Lakehouse Studio 中监控活动

### 使用查询历史记录监控查询活动

您可以监控和查看查询详细信息，探索已执行查询的性能，监控数据加载状态和错误，查看任务图，并根据需要进行调试和重新运行。您还可以监控动态表的刷新状态，并查看创建的用于维护数据治理的各种标记和安全策略。

![](.topwrite/assets/image_1742438014544.png)

有关详细信息，请参阅以下文档：

* [使用查询历史记录监控查询活动](web-job-history.md)

### 使用运维中心监控工作流的任务

运维中心为任务和实例提供管理操作。运维中心管理的工作流任务包括手动触发的任务、定期计划的任务及其对应的实例，以便进行集中管理。

![](.topwrite/assets/image_1742438023150.png)

数据回填涉及在特定时间段内补充历史或未来的数据，并将其写入相应的时间分区。如果代码中包含调度参数，这些参数将根据选定的数据回填业务时间自动填充适当的值。结合业务逻辑，这确保了相应时间段的数据被写入到指定的分区。写入的分区以及执行的代码逻辑由代码中的任务定义决定。

![](.topwrite/assets/image_1742438034252.png)

监控功能使您能够利用内置规则或自定义配置，密切关注异常情况（如任务执行失败），并在需要时发送告警通知。

![](.topwrite/assets/image_1742438047787.png)

有关详细信息，请参阅以下文档：

* [任务实例维护](task-instance-maintenance.md)
* [数据回填](backfilling_data.md)
* [监控告警](monitoring_and_alerting.md)

## 执行计算资源管理和管理 Lakehouse Studio

这些页面可帮助您了解 Lakehouse 数据使用情况，管理虚拟集群，监控虚拟集群中的任务队列，管理用户和角色，管理 Lakehouse 账户等。

您可以管理和监控虚拟集群。

![](.topwrite/assets/image_1742438058433.png)

访问用户和角色。

![](.topwrite/assets/image_1742438325404.png)

执行成本管理。

![](.topwrite/assets/image_1742438412611.png)

^

当您以具有**账户管理员角色**的用户身份登录时，可以在账户中心的**计费**功能下查看账户的使用记录（\<your\_accounts\_name>.[accounts.clickzetta.com/billing](http://accounts.clickzetta.com/billing)）。您还可以按 SKU 类型（如计算、存储、网络或特定 SKU）查询详细费用。

有关详细信息，请参阅以下文档：

* [了解工作区](workspace-introduction.md)
* [管理账户](ManageAccounts.md)
* [管理用户](account_user_management.md)
* [管理服务实例](managing-instance.md)
* [用户和权限管理](authoritymanagement.md)

## 相关视频

使用 Lakehouse Studio 实现实时数据摄取到实时数据分析。

```[bilibili]
https://www.bilibili.com/video/BV1TfYYeEEYg/
```

^

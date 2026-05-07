# 将Spark数据工程最佳实践项目迁移到云器Lakehouse

## 新方案亮点

* **全面云化，聚焦数据**：将线下管理的环境全部迁移到云上，免去资源准备、系统运维等非数据相关的工作。
* **易于迁移**：云器 Lakehouse SQL、Zettapark 与 Spark SQL、pySpark 分别具有高度兼容性，代码迁移的难度与成本极低。
* **降低总体成本与复杂度**：云器 Lakehouse 内置工作流服务与数据质量控制服务，无需单独的 Airflow 和 Great Expectations。极大程度简化了系统架构，降低了总体成本与复杂度。
* **具备开放性**：同时能够在架构中保留 Airflow 和 Greate Expectations，借助 Airflow 调度 Python 任务，并在 Python 代码中持续调用 Great Expectations 开展数据质量检测。
* **资源管理与任务队列管理**：分别运用不同的 Virtual Cluster 处理 ETL、BI 以及数据质量的作业，达成资源隔离与任务队列管理。

## Spark数据工程最佳实践项目介绍

### Spark数据工程最佳实践项目背景

在缺乏充分指导的情形下构建数据管道，可能会令人感到无所适从，难以判定自身是否遵循了最佳实践。倘若您身为一名数据工程师，期望明晰自身技术技能在构建数据管道方面的发展状况，但对是否遵循了行业标准存疑，也不确定能否与大型科技公司的数据工程师相较，那么 GitHub 上的 [Spark数据工程最佳实践](https://github.com/josephmachado/data_engineering_best_practices/tree/main) 项目便是为您量身定制的。本文将对设计数据管道、洞悉行业标准、考量数据质量以及编写可维护且易于操作的代码的最佳实践予以回顾。完成此项目后，您将洞悉设计数据管道的关键组件及其需求，并且能够迅速熟悉任何新的代码库。

### Spark数据工程最佳实践项目场景

假设我们从上游来源提取客户和订单信息，并创建订单数量的每小时报告。

:-: ![](.topwrite/assets/image_1737530842475.png =405)

使用的组件和环境如下：

* 数据存储：MinIO with Delta Table Format
* 数据处理：Spark
* 代码语言：PySpark + Spark SQL
* 数据质量：Great Expectations
* 工作流：Airflow
* 运行环境：本地Docker（Spark、Airflow）

### Spark数据工程最佳实践项目最佳实践

#### 使用标准模式逐步转换数据

遵循既定的数据处理流程有助于处理常见的潜在问题，并且您可参考大量的资料。大多数行业标准模式均遵循三层数仓架构，具体如下：

1. **原始层**：按上游源端的原始状态存储数据。此层有时会涉及数据类型的更改和列名的标准化。
2. **转换层**：依据所选的建模原则对原始层的数据进行转换，从而形成一组表。常见的建模原则包括维度建模（Kimball）、Data Vault 模型、实体关系数据模型等。
3. **消费层**：将来自转换层的数据加以组合，形成直接与最终用户用例相对应的数据集。消费层通常涉及连接和聚合转换层表，以方便最终用户对历史性能进行分析。**业务特定的指标**通常在此层定义。我们应确保**一个指标仅在一个位置定义**。
4. **接口层（可选）**：消费层中的数据通常会遵循数据仓库的命名/数据类型等。然而，呈现给最终用户的数据应具备易用性和易理解性。接口层通常是作为仓库表与其消费者之间接口的**视图**。

:-: ![](.topwrite/assets/image_1737530923177.png =808)

^

上图中的青铜层（Bronze Layer）、白银层（Silver Layer）、黄金层（Gold Layer）和接口层（User Interface）分别与上述的原始层、转换层、消费层和接口层相对应。我们针对白银层采用了维度建模的方法。对于管道/转换函数/表而言，输入被称为“上游”，输出则被称为“下游”消费者。在规模较大的公司中，多个团队在不同的层级上开展工作。数据采集团队或许会将数据导入青铜层，而其他团队能够依据自身需求构建属于自己的白银层和黄金层的表。

^

#### 在将数据提供给消费者之前确保数据有效（又称为数据质量检查）

在构建数据集时，明确对数据的期望至关重要。对数据集的期望可以简单到列值符合要求，也可以复杂到满足更复杂的业务需求。若下游消费者使用了不良数据，其后果可能是灾难性的。例如，向客户发送错误的数据或基于不正确的数据进行资金支出。纠正不良数据使用的过程通常需要耗费大量时间，并重新运行所有受影响的流程！

为防止消费者意外使用不良数据，我们应当在提供数据以供使用之前对其进行检查。

本项目使用[Great Expectations](https://www.startdataengineering.com/post/ensuring-data-quality-with-great-expectations/) 库来定义和运行数据检查。

#### 使用幂等的数据管道避免数据重复

重跑，即重新运行数据管道，是一种常见操作。在重新运行数据管道时，我们必须确保输出不包含重复的行。系统在给定相同输入的情况下始终产生相同输出的特性称为幂等性。

以下展示了重新运行数据管道时避免数据重复的两种技术：

1. **基于运行 ID 的覆盖**：用于仅附加输出数据。请确保您的输出数据具有运行 ID 作为分区列（例如，我们的黄金表中的分区列）。运行 ID 表示创建的数据所属的时间范围。当重新处理数据时，依据给定的运行 ID 进行覆盖。
2. **基于自然键的 UPSERTS**：在管道使用自然键对输出数据执行插入和更新时使用。当需要更新现有行的维度数据时（例如 SCD2 采用此方法）。重新运行管道产生的重复会致使现有行的更新（而非在输出中创建新行）。我们使用此方法来填充 dim\_customer 表。

^

## 迁移方案

### 基于云器Lakehouse的新架构

:-: ![](.topwrite/assets/image_1737601829558.png =828)

### 两种方案的组件对比

:-: ![](.topwrite/assets/image_1737537672374.png =828)

^

| **组件**   | **Spark方案**                   | **云器Lakehouse服务**                                |
| -------- | ----------------------------- | ------------------------------------------------ |
| **数据存储** | MinIO with Delta Table Format | 阿里云OSS(or AWS S3, etc) with Iceberg Table Format |
| **数据处理** | Spark                         | 云器Lakehouse                                      |
| **代码语言** | PySpark + Spark SQL           | ZettaPark + Lakehouse SQL                       |
| **数据质量** | Great Expectations           | 云器Lakehouse DQC(数据质量)                            |
| **工作流**  | Airflow                       | 云器Lakehouse Workflow                             |
| **运行环境** | 本地Docker（Spark、Airflow）       | 云上Serverless服务                                   |

### 语法差异

| **功能**        | **Spark语法**                                                 | **云器Lakehouse语法**                                        |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| **建表DDL**     | CREATE TABLE ... USING DELTA ... LOCATION '{path}/customer' | CREATE TABLE, 不需要USING DELTA和LOCATION '{path}/customer'  |
| **创建Session** | SparkSession.builder.appName                                | Session.builder.configs(connection\_parameters).create() |

### 新方案的特点

* **全面云化，聚焦数据**：将线下管理的环境全部迁移到云上，免去资源准备、系统运维等非数据相关的工作。
* **易于迁移**：云器 Lakehouse SQL、Zettapark 与 Spark SQL、pySpark 分别具有高度兼容性，代码迁移的难度与成本极低。
* **降低总体成本与复杂度**：云器 Lakehouse 内置工作流服务与数据质量控制服务，无需单独的 Airflow 和 Great Expectations。极大程度简化了系统架构，降低了总体成本与复杂度。
* **具备开放性**：同时能够在架构中保留 Airflow 和 Greate Expectations，借助 Airflow 调度 Python 任务，并在 Python 代码中持续调用 Great Expectations 开展数据质量检测。
* **资源管理与任务队列管理**：分别运用不同的 Virtual Cluster 处理 ETL、BI 以及数据质量的作业，达成资源隔离与任务队列管理。

## 迁移步骤

### 任务代码开发

导航到[Lakehouse Studio](studio_overview.md)的开发->任务，构建如下任务树：

^

:-: ![](.topwrite/assets/image_1737533356377.png =827)

^

单击“+”新建如下目录：

* 01\_QuickStarts\_data\_engineering\_best\_practices

单击“+”新建如下SQL任务：

* 00\_setup\_env

单击“+”新建如下Python任务：

* 01\_DDL
  * create\_bronze\_tables.py
  * create\_gold\_tables.py
  * create\_interface\_views.py
  * create\_silver\_tables.py
* 02\_Pipeline
  * sales\_mart.py

访问本迁移项目的 [Github代码库](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/data_engineering_best_practices)，将代码分别复制到对应的任务里。

^

### 资源管理和任务队列管理

在set\_env任务里，通过创建三个Virtual Cluster（虚拟集群）来运行不同的任务：

```SQL
-- virtual cluster
CREATE VCLUSTER IF NOT EXISTS data_engineering_best_practices_vc_etl
   VCLUSTER_SIZE = XSMALL
   VCLUSTER_TYPE = GENERAL
   AUTO_SUSPEND_IN_SECOND = 10
   AUTO_RESUME = TRUE
   COMMENT  'data_engineering_best_practices_vc_etl';

CREATE VCLUSTER IF NOT EXISTS data_engineering_best_practices_vc_bi
   VCLUSTER_SIZE = XSMALL
   VCLUSTER_TYPE = ANALYTICS
   AUTO_SUSPEND_IN_SECOND = 300
   AUTO_RESUME = TRUE
   COMMENT  'data_engineering_best_practices_vc_bi';

CREATE VCLUSTER IF NOT EXISTS data_engineering_best_practices_vc_dqc
   VCLUSTER_SIZE = XSMALL
   VCLUSTER_TYPE = GENERAL
   AUTO_SUSPEND_IN_SECOND = 10
   AUTO_RESUME = TRUE
   COMMENT  'data_engineering_best_practices_vc_dqc';
```

### 任务参数配置

#### 01\_DDL任务参数配置

分别给如下四个任务配置参数：

* create\_bronze\_tables.py
* create\_gold\_tables.py
* create\_interface\_views.py
* create\_silver\_tables.py

打开任务，点击“调度”：

![](.topwrite/assets/image_1737534509318.png =474)

在弹出页面点击“加载代码中参数”：

:-: ![](.topwrite/assets/image_1737534572480.png =567)

设定每个参数的取值：

:-: ![](.topwrite/assets/image_1737534633567.png =562)

如何获得参数值请参考 [这篇文章](https://uat-doc.clickzetta.com/JDBC-Driver)。

^

#### 02\_Pipeline ETL任务参数配置

给如下任务配置参数，参数配置的方法同上。

* sales\_mart.py

### 创建环境

运行 setup_env 和 DDL 临时任务，创建运行所需要的虚拟计算集群、数据库 Schema 以及 Tables。
创建运行所需要的虚拟计算集群、数据库Schema：

:-: ![](.topwrite/assets/image_1737534798871.png =599)

创建Tables:

:-: ![](.topwrite/assets/image_1737534852030.png =594)

### 配置数据质量监控规则

导航到[Lakehouse Studio](studio_overview.md)的数据->数据质量->质量规则，新建如下规则：

:-: ![](.topwrite/assets/image_1737534933748.png =597)

以expectation\_suite\_name是customer为例

:-: ![](.topwrite/assets/image_1737535012940.png =594)

配置如下规则：

:-: ![](.topwrite/assets/image_1737535163110.png =615)

### 工作流调度

导航到[Lakehouse Studio](studio_overview.md)的开发->任务，
对sales\_mart.py ETL任务进行调度配置：

:-: ![](.topwrite/assets/image_1737535319989.png =578)

从而实现1小时为周期的报表数据刷新。

然后点击“提交”，按周期执行该ETL任务：

![](.topwrite/assets/image_1737535401895.png =723)

### 任务运维

#### ETL任务运维

导航到[Lakehouse Studio](studio_overview.md)的运维监控->任务运维，查看任务状态，执行日志、实例管理等。

:-: ![](.topwrite/assets/image_1737535489873.png =712)

#### 数据质量控制

导航到[Lakehouse Studio](studio_overview.md)的数据->数据质量，在数据质量中可以配置质量规则来监控数据表的产出是否正常。

查看校验对象：

:-: ![](.topwrite/assets/image_1737535653201.png =729)

查看校验结果：

:-: ![](.topwrite/assets/image_1737535687027.png =720)

^
^

#### 监控告警配置

下一步可以导航到运维监控->监控告警，增加告警规则，实现对ETL任务和数据质量控制的实时告警。

^

**使用内置的监控告警规则**：

在系统内部，内置了如下通用的监控告警规则，在数据质量校验失败时，会按照规则中的具体配置来触发邮件、短信、电话等告警。

:-: ![](.topwrite/assets/image_1737600310887.png =720)

^

**使用自定义监控告警规则**：

上述内置的监控告警规则，是对全局所有的质量监控规则的校验结果都生效。如果想进一步精细化控制告警的监测范围和告警策略，也可以自定义的新建规则，如下图所示，选择“质量规则校验失败”的监控事项，并给定限制范围的过滤条件。监控告警配置的详细指南，可以参考 [监控告警](monitoring_and_alerting.md) 使用指南。

:-: ![](.topwrite/assets/image_1737600502785.png =720)

^

## 参考资料

* [任务开发与调度](taskdevelop.md)
* [Python任务开发与调度、工作流编排](Python_Task.md)
* [Zettapark快速上手](ZettaparkQuickStart.md)
* [任务参数](task_param.md)
* [监控告警](monitoring_and_alerting.md)

^

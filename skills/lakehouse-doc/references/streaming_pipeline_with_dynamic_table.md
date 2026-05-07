# 开发动态表实现近实时增量处理

> **【预览发布】** 本功能当前处于受邀预览阶段。如需试用，请通过官网联系方式联系云器科技。

## 教程概述

通过本教程，您将了解到如何使用Lakehouse动态表(Dynamic Table)构建一个完整的实时数据ETL加工流程。场景设计如下： 

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tutorial_dt_scenario.jpg?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=2034679003\&Signature=gewhAp%2FJ80Uu%2BFq1sNEH3fwQI54%3D)

 本教程将通过数据导入任务、基于动态表实现的数据清洗转换和数据聚合任务，实现了一个分钟级延迟的流式数据处理Pipeline案例。

> 本教程借助 Lakehouse Tutorial，提供了在线教程指南以及脚本导入功能。您可以在登录 Lakehouse Web 控制台后，通过 Lakehouse Tutorial 的“Lakehouse教程”入口进入，并根据在线指南引导完成教程。
> ![](<.topwrite/assets/截屏2025-01-14 19.36.29.png>)

### 入门知识

动态表（Dynamic Table）是一种支持仅处理增量变化数据的对象类型，与物化视图类似。创建动态表时，您需要同时定义数据计算逻辑。通过刷新操作，可以触发动态表的计算逻辑并更新其数据。与传统的 ETL 任务相比，动态表只需要在定义时声明全量语义的计算逻辑，在刷新时则可自动进行增量计算优化。借助动态表，Lakehouse可以面向流式写入的数据进行近实时增量处理，为实时分析提供数据准备。

### 教程步骤

1. **数据导入**：创建原始表、持续写入用户行为数据；
2. **开发动态表模型**：通过 Dynamic Table 分别构造数据清洗、数据聚合的加工流程。
3. **验证加工结果**：监控由动态表构造的数据Pipeline的刷新执行状态，同时查看消费层数据表的变化情况，验证实时数据加工结果

通过以上步骤，您将了解如何通过动态表在 Lakehouse 中开发流式处理任务。

## 准备工作

首先，创建行为日志表，通过INSERT INTO任务写入测试数据。

> 为了简化教程，本教程通过周期性调度 INSERT INTO 任务模拟数据的持续写入。实际生产环境中往往使用流式写入接口实时接入数据，云器 Lakehouse 也提供 SDK/Flink Connector 等方式进行实时写入，不建议在生产任务中使用 INSERT INTO 方式写入。

本教程在“开发”模块提供了创建数据表以及插入测试数据的 SQL 脚本。打开 [Tutorial_Working_With_Dynamic_Table->Step01.Preparation] 脚本文件，配置 1Min 间隔的调度策略并提交部署，以模拟实时数据导入。

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tutorial_dt_insert.gif?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=2034681423\&Signature=m9w14ltjxHYgEUBkADmFSenqmeU%3D)

## Transform Layer动态表模型开发

在“开发”模块打开 [Tutorial_Working_With_Dynamic_Table->Step02.Transformation_With_Dynamic_Table] 样例动态表任务文件。该动态表定义了对原始表进行清洗转换的 ETL 逻辑。

请参考下图进行调度配置"运行集群"和"调度参数"：

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tutourial_dt_transform.gif?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=2034682100\&Signature=z8F6by8Cae7HFYeTggx0VR7NGxQ%3D)

## 提交部署

点击\[提交]按钮，将动态表模型部署到Lakehouse目标环境中，系统将根据动态表设置的刷新频率自动刷新。

## Aggregate Layer动态表模型开发

在“开发”模块打开 [Tutorial_Working_With_Dynamic_Table->Step03.Aggregation_With_Dynamic_Table] 样例动态表任务文件。该动态表定义了对中间层数据模型进行聚合分析的 ETL 逻辑。

请参考下图进行调度配置和提交运行：

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tutourial_dt_agg.gif?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=2034682137\&Signature=jcNW0LS9R3H2TuyP9xY17097tPk%3D)

## 验证增量更新结果

在“开发”模块打开 Step04.Check_Data_Freshness 文件，通过执行 Query 检查自动刷新动态表的数据新鲜度。
![](.topwrite/assets/image_1725463960356.png =754)
如上图所示，借助动态表的自动增量刷新功能，能够以 1min 左右的时间延迟完成数据的实时处理。

## 环境清理

在“任务运维”模块的周期性任务列表中，下线数据导入任务；在动态表任务列表中，下线 2 个动态表模型任务。

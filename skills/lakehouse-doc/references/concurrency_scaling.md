# 通过横向弹性扩容支持多并发查询

## 概述

通过本教程，您将了解到如何利用 Lakehouse 虚拟计算集群的横向弹性扩容能力，支持客户端动态变化的多并发查询。

> 本教程借助 Lakehouse Tutorial 智能助手，提供了在线教程指南以及脚本导入功能。您可以在登录 Lakehouse Web 控制台后，通过 Lakehouse Tutorial 的“Lakehouse教程”入口进入教程，并根据在线指南引导完成教程。
> ![](.topwrite/assets/image_1736854951691.png)

### 导入脚本

打开控制台 Tutorial 页面中的“Lakehouse教程”，选择“通过横向弹性扩容支持多并发查询”课程。根据页面提示导入本次课程需要的脚本文件。

在“开发”模块查看“Tutorial_Working_With_Concurrency_Scaling”目录。

![](.topwrite/assets/image_1725287877169.png =436)

### 入门知识

虚拟计算集群（Virtual Cluster，简称 VC 或集群）是云器 Lakehouse 提供数据处理和分析的计算资源对象。虚拟计算集群提供在 Lakehouse 中执行 SQL 作业所需的 CPU、内存、本地临时存储（SSD 介质）等资源。集群具备快速创建/销毁、扩容/缩容、暂停/恢复等特点，按照资源规格大小以及使用时长进行收费，暂停或删除后不产生费用。虚拟计算集群针对 ETL 和分析场景，提供通用型和分析型两种集群类型，以满足不同负载的隔离和优化需求。

![](.topwrite/assets/image_1714992266569.png =700)

### 教程步骤

1.  **环境准备**：创建测试使用的计算集群。
2.  **发起查询**：使用 Studio Web 环境创建 Python 任务对 Lakehouse 使用不同并发度进行连续查询，观察 Python 任务的执行日志结果，了解集群在不同并发请求下的快速扩缩容能力。
3.  **清理环境**：删除测试使用的计算集群。

通过以上步骤，您将能够了解如何配置和使用虚拟集群的弹性并发功能，并了解其性能表现。

## 准备工作

首先，通过 SQL 命令来创建分析型计算集群，并开启和设置弹性并发功能。

本教程通过在“开发”模块运行 [Tutorial_Working_With_Concurrency_Scaling->Step01.Preparation] SQL 脚本任务来创建集群，并设置弹性扩容策略。
![](.topwrite/assets/image_1725288058473.png)

## 使用Python程序发起并发查询

在“开发”模块打开 [Tutorial_Working_With_Concurrency_Scaling->Step02.Run_Concurrent_Queries] Python 并发任务模板，您需要修改 connect 连接配置参数，才能连接 Lakehouse 并执行查询。

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_concurrent_connection.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880895431\&Signature=B2eODbnltYz%2FzjifxINWWzcf%2Bzw%3D)

修改连接信息后，请点击任务运行，并查看任务执行日志。

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_concurrent_report.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880982939\&Signature=%2B1YAL8o1IDjFdlaIpBgxB0Sa%2B90%3D)
通过观察打印的性能报告，可以发现 Reporting_VC 集群随着客户端并发请求的梯度增加，通过动态增加副本（Replica）数量，实现了毫秒级延迟的横向扩容。在动态扩容的同时，仍能保持对持续并发请求的查询服务等级协议（SLA）。

在执行任务的同时，您也可以通过集群监控页面查看集群的并发请求以及弹性扩容情况。

![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/python_concurrency_scaling.gif?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=2034444050\&Signature=wnBuZv1bereCq1etNW66OrF6UsA%3D)

## 环境清理

打开“开发”模块中的 [Tutorial_Working_With_Concurrency_Scaling->Step03.Clean_Up] SQL 脚本文件，执行脚本即可删除本教程测试集群。
![](.topwrite/assets/image_1725288753867.png)

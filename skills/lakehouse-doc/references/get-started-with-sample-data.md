# 通过样例数据集开始TPCH查询

## 概述

通过本教程，您将了解如何利用 Lakehouse 平台内置的样例数据集，无需提前准备数据即可快速使用 SQL 进行查询分析，以评估 SQL 功能及性能。

> 本教程借助 Lakehouse Tutorial，提供了在线教程指南以及脚本导入功能。您可以在登录 Lakehouse Web 控制台后，通过 Lakehouse Tutorial 入口进入教程，并根据在线指南引导完成教程。
> ![](.topwrite/assets/image_1736854694431.png)

### 导入脚本

打开控制台 Tutorial 页面中的“Lakehouse 教程”，选择“使用样例数据快速开始查询分析”课程。根据页面提示导入本次课程需要的脚本文件。

在“开发”模块查看“Tutorial_Run_TPCH_Queries_USING_SQL”目录。
![](.topwrite/assets/image_1725286019515.png)

### 样例数据集

样例数据集由云器平台通过名称为 CLICKZETTA_SAMPLE_DATA 的数据集以共享方式开放给所有账户查询。本教程将以其中的 TPC-H 100GB 数据集为例，介绍如何在 Lakehouse 中快速完成 TPC-H 测试集的查询测试，评估处理性能。

### 教程步骤

1.  **环境准备**：通过样例数据集检查原始数据，创建测试使用的计算集群。
2.  **发起查询**：使用 Studio Web 环境创建 SQL 查询完成 22 个 TPC-H SQL 查询。
3.  **变更集群大小**：调整集群大小，扩大至之前集群大小的 2 倍。
4.  **发起查询**：使用调整大小后的集群再次完成 22 个 TPC-H SQL 查询。
5.  **观察不同集群规格下查询时延的变化**：
6.  **清理环境**：删除测试使用的计算集群。

通过以上步骤，您将能够评估不同集群规格下 SQL 查询的性能表现。

## 准备工作

首先，登录 Lakehouse Web 控制台并进入指定的工作空间后，可访问数据模块，检查数据管理下的数据对象列表中“clickzetta_sample_data.tpch_100g”下的相关表是否存在。
![](.topwrite/assets/image_1716285499384.png)

其次，我们将为本次测试临时创建一个独立计算集群用于查询分析。您可以通过访问 Lakehouse Web 控制台的“计算 → 集群”菜单，通过页面向导新建集群。
![](.topwrite/assets/tpch_100g_vc.png)

同时，您也可以通过 SQL 命令来创建集群。通过 SQL 命令操作时，您可以不离开 SQL 开发上下文，在 Ad-hoc 或者 ETL 开发过程中通过 SQL 命令控制集群创建、扩/缩容、暂停/恢复、销毁等动作，往往可以提高计算资源的操作效率。

本教程通过在“开发”模块运行 [Tutorials/Tutorial_Run_TPCH_Queries_USING_SQL/Step01.Preparation] SQL 脚本任务，创建分析 TPC-H 数据集所需使用的计算集群。
![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_tpch_vc01.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880885164\&Signature=wYmSy3IVRKBT7mWtGhuKwT%2BwufQ%3D)

## 对样例数据进行TPC-H的查询

在“开发”模块打开 [Tutorials/Tutorial_Run_TPCH_Queries_USING_SQL/Step02.Run_TPCH_Queries] SQL 脚本文件，将看到 TPC-H 的 22 个查询语句已录入。在[集群]下拉列表中选择刚才创建的测试集群，然后选中任务中的全部脚本，点击[运行]按钮进行串行查询。
![](.topwrite/assets/image_1725354834261.png)

执行完毕后，可通过当前 SQL Editor 的运行历史查看本次任务的运行耗时。

如果您希望进行性能测试，可连续执行 2 次以上的查询，以便计算集群能够充分缓存（Cache）数据，发挥最佳性能。以下是第二次运行，计算集群缓存（Cache）数据后的运行结果，较第一次无缓存（Cache）时性能有明显提升。
![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_tpch_run_queries2.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880886165\&Signature=XHaygkpuFRtqy%2FG1EExOjIfq7vw%3D)

如需查看 22 个查询中每个查询的执行详情，可访问“计算 → 作业历史”，根据查询标签“tpch100g_benchmark”对查询历史进行过滤后查看。

![](.topwrite/assets/image_1716285600039.png)

## 扩大集群规格后查询

通过“计算 → 集群”管理页面，您可以对刚才创建的测试集群修改规格大小，从 Large 修改至 XLarge。XLarge 规格大小为 Large 的 2 倍。

> 注：计算集群的 `vcluster_size` 参数同时支持以 T-shirt size（XSMALL、SMALL、Large 等）和以数字（1, 2, 4, 16 等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)


![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_tpch_resize_vc.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880886486\&Signature=MJGwOtPq%2BHpD5E1WsHu1iyGrDnQ%3D)

或者在 SQL 脚本中执行以下命令进行修改：

```
-- 修改集群大小
alter vcluster TPCH_100GB SET VCLUSTER_SIZE = 'XLARGE';
```

修改后，使用调整大小后的集群再次进行查询测试。
![](https://studio-prod-sh.oss-cn-shanghai.aliyuncs.com/fe-asset/tutorials/resources/tu_tpch_round2.png?OSSAccessKeyId=LTAI5tBH4MDxrfQw7VTx4w2B\&Expires=1880886763\&Signature=UCaQAhoOLbeCKPrNUz22TVfAXNs%3D)
新扩容的计算节点充分缓存（Cache）数据后，性能会继续提升。
通过作业的运行时间可以观察到，对于相同的数据规模和查询任务，扩大计算集群规格后，任务的总体运行时间大为缩短。两次执行后，随着数据被缓存，查询性能能得到提升。

## 环境清理

打开“开发”模块 [Tutorial_Run_TPCH_Queries_USING_SQL/Step03.Clean_Up] SQL 脚本文件，执行脚本即可删除本教程的测试集群。
![](.topwrite/assets/image_1725288859033.png)

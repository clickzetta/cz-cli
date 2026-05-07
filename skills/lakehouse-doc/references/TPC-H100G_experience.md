# 三分钟用一瓶水的代价体验TPC-H 100G性能测试

TPC-H 是由事务处理性能委员会 (TPC) 开发的决策支持基准。它由一套面向业务的临时查询和并发数据修改组成。TPC-H 可以根据真实的生产环境建立模型，模拟销售系统的数据仓库。本次测试使用 8 张表，数据大小为 100 GB。总共测试了 22 个查询，主要性能指标是每个查询的响应时间，即从提交查询到返回结果之间的持续时间。
TPC-H 性能测试是一个费时、费钱的过程。为了完成测试，需要准备机器、准备数据、生成报告等，往往需要数天时间以及高昂的费用。基于云器 Lakehouse 秒级弹性伸缩的虚拟集群以及共享的 TPC-H 数据集，免去了资源和数据的准备过程。基于本文提供的方法，您可以在 3 分钟内体验云器 Lakehouse 的完整性能测试并查看对比报告。
本文代码运行在[Zeppelin](eco_integration/Zeppelin.md)。如果您想运行本文代码，请按照文档说明安装[Zeppelin](eco_integration/Zeppelin.md)。

## 创建测试用AP VC

```
-- 创建分析型虚拟计算资源
create vcluster if not exists VC_TPCH_100GB vcluster_size='Large' vcluster_type='Analytics'  AUTO_RESUME=TRUE AUTO_SUSPEND_IN_SECOND=300 min_replicas=1 max_replicas=1 comment 'TPCH 100GB TEST';

use vcluster VC_TPCH_100GB;
```

## 了解待测试数据

本测试使用TPC-H 100 GB dataset。基于云器Lakehouse天生的存算分离架构，共享了该数据集（clickzetta\_sample\_data.tpch\_100g），用户可以直接访问，从而免去了数据准备过程。

```
select "customer" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.customer
union all select "lineitem" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.lineitem
union all select "nation" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.nation
union all select "orders" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.orders
union all select "part" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.part
union all select "partsupp" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.partsupp
union all select "region" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.region
union all select "supplier" as tablename, count(*) as row_count from clickzetta_sample_data.tpch_100g.supplier;
```

运行上述代码，得到测试数据集每张表的行数：
![](.topwrite/assets/image_1718710238102.png)

## 测试过程

![](.topwrite/assets/20240618195336_rec_.gif)

整个过程耗时不到 3 分钟，其中 22 个 SQL 查询运行总计耗时 16.718 秒。费用方面，本次测试采用的是 Large 规格的虚拟计算集群，3 分钟的费用约为 1.38 元，相当于用一瓶水的代价完成了本次测试。

## 恭喜，任务完成！

请享受过程并深入学习！

## 附录

### 下载Zeppelin Notebook源文件

[02.Quick Start ClickZetta Lakehouse Benchmark with TPCH Sample Data..ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/02.Quick%20Start%20ClickZetta%20Lakehouse%20Benchmark%20with%20TPCH%20Sample%20Data..ipynb)
[02.Quick Start ClickZetta Lakehouse Benchmark with TPCH Sample Data\_2JH4XMBUG.zpln](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/02.Quick%20Start%20ClickZetta%20Lakehouse%20Benchmark%20with%20TPCH%20Sample%20Data_2JH4XMBUG.zpln)

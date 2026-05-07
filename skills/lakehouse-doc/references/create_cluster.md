# 创建计算集群

## 功能描述

本功能允许用户根据指定的名称和配置，在执行SQL的工作空间下创建计算集群。计算集群（Virtual-Cluster，简称：VCluster）是云器Lakehouse提供的计算资源集群服务，提供执行查询分析所需的CPU、内存、临时存储等资源。用户可以使用计算集群执行各类ETL、流式分析、即席查询及数据集成等作业。在Lakehouse中执行需要计算的SQL Select查询或各类DML操作（如DELETE,INSERT,UPDATE等）时，都将使用计算集群。

计算集群包括通用型（GENERAL PURPOSE VIRTUAL CLUSTER，简称：GP类型）、分析型（ANALYTICS PURPOSE VIRTUAL CLUSTER，简称：AP类型）和同步型（INTEGRATION VIRTUAL CLUSTER）三种类型。

通用型计算集群中，提交至计算集群的作业共享集群内的计算资源，适合处理离线作业；分析型集群具备多计算实例、自动弹缩的功能特性，适合处理在线、高并发类的作业。同步型集群专门用于数据集成任务。

## 语法

```SQL
-- 创建计算集群
CREATE VCLUSTER [IF NOT EXISTS] <name>
objectProperties
[COMMENT '']

--参数说明 
--创建分析型计算集群（ANALYTICS PURPOSE VIRTUAL CLUSTER）适用属性           
objectProperties ::=
            VCLUSTER_SIZE = num --1至256的整数，且须为2的n次幂。
            VCLUSTER_TYPE = ANALYTICS
            MIN_REPLICAS = num
            MAX_REPLICAS = num
            AUTO_SUSPEND_IN_SECOND = num
            AUTO_RESUME = TRUE| FALSE
            MAX_CONCURRENCY = num
            QUERY_RUNTIME_LIMIT_IN_SECOND = num
            PRELOAD_TABLES = "<schema_name>.<table_name>[,<schema_name>.<table_name>,...]"
            
            
--创建通用型计算集群（GENERAL PURPOSE VIRTUAL CLUSTER）适用属性             
objectProperties ::=
            [VCLUSTER_SIZE = num | MIN_VCLUSTER_SIZE=num  MAX_VCLUSTER_SIZE=num] --1至256的整数 
            VCLUSTER_TYPE = GENERAL 
            AUTO_SUSPEND_IN_SECOND = num
            AUTO_RESUME = TRUE| FALSE
            QUERY_RUNTIME_LIMIT_IN_SECOND = num
            QUERY_RESOURCE_LIMIT_RATIO=num;

--创建同步型计算集群（INTEGRATION VIRTUAL CLUSTER）适用属性             
objectProperties ::=
            [VCLUSTER_SIZE = num | MIN_VCLUSTER_SIZE=num  MAX_VCLUSTER_SIZE=num] --0.25、0.5或者1至256的整数 
            VCLUSTER_TYPE = INTEGRATION 
            AUTO_SUSPEND_IN_SECOND = num
            AUTO_RESUME = TRUE| FALSE
            QUERY_RUNTIME_LIMIT_IN_SECOND = num
            QUERY_RESOURCE_LIMIT_RATIO=num;
```

**1. name**：计算集群的名字。在工作空间内唯一，创建后不可变更。命名规则为：3到28个字符，仅支持字母、下划线、十进制数字 (0-9)，不允许有空格。

**2. objectProperties**：创建计算集群可以指定的属性，属性的具体含义和取值如下：

| 字段名称                              | 字段含义                                                                                                                      | 取值范围                                                               | 默认值     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| VCLUSTER\_SIZE                    | 计算集群规格。支持从1 CRU到256 CRU的规格，算力依次加大。（分析型集群须为2的n次幂，同步型集群单独支持0.25 CRU和0.5 CRU两种小规格）                                           | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 1       |
| MIN\_VCLUSTER\_SIZE               | 仅通用型（GENERAL）集群适用。&#xA;计算集群弹缩时的最小规格，支持从1 CRU到256 CRU的规格，需要小于等于MAX\_VCLUSTER\_SIZE参数。不可与VCLUSTER\_SIZE同时使用。                | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 无       |
| MAX\_VCLUSTER\_SIZE               | 仅通用型（GENERAL）集群适用。&#xA;计算集群弹缩时的最大规格，支持从1 CRU到256 CRU的规格，需要大于等于MIN\_VCLUSTER\_SIZE参数。不可与VCLUSTER\_SIZE同时使用。                | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 无       |
| VCLUSTER\_TYPE                    | 计算集群类型。&#xA;GENERAL：适用于数据摄取和ELT操作；&#xA;ANALYTICS：适用于查询Latency和并发能力有强保障需求的场景。&#xA;INTEGRATION：用于数据集成任务场景。                  | GENERAL \| ANALYTICS \| INTEGRATION                                 | GENERAL |
| MIN\_REPLICAS                     | 计算集群最小实例数。仅适用于分析型计算集群。                                                                                                    | 1-10                                                               | 1       |
| MAX\_REPLICAS                     | 计算集群最大实例数。仅适用于分析型计算集群。                                                                                                    | 1-10                                                               | 1       |
| AUTO\_SUSPEND\_IN\_SECOND         | 集群自动关闭的空闲时长。单位：秒。                                                                                                         | 取值 -1或大于等于15的整数。&#xA;-1表示不自动停止。                                    | 600     |
| AUTO\_RESUME                      | 是否自动恢复。                                                                                                                   | TRUE \| FALSE                                                         | TRUE    |
| MAX\_CONCURRENCY                  | 计算集群中每个计算实例可负载的最大并发数。仅适用于分析型计算集群。                                                                                         | 1-32                                                               | 8       |
| QUERY\_RUNTIME\_LIMIT\_IN\_SECOND | 提交至该计算集群上的作业，可执行的最大时长。单位：秒。                                                                                               | 大于0的整数。                                                            | 86400   |
| PRELOAD\_TABLES                   | 计算集群可通过配置preload\_table，定时或被触发拉取preload\_table中指定的表数据到计算集群本地的SSD硬盘上进行缓存。您还可以在表上[设置缓存策略](create-table-ddl.md)。仅适用于分析型计算集群。 | schema\_name.table\_name，多个表名称之间用英文逗号分隔。支持通配符，例如：sample\_schema.\* | null    |
| QUERY\_RESOURCE\_LIMIT\_RATIO     | **单作业资源占比阈值**,单个查询任务可使用的CPU/内存资源不超过集群总资源的指定比例                                                                             | `0.0` \~ `1.0`（如 `0.1` 表示10%）                                      | 1.0     |

> 注：计算集群的vcluster\_size参数同时支持以T-shirt size（XSMALL、SMALL、Large等）和以数字（1,2,4,16等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

**3.创建时指定 GP 型 VC 的最大和最小值**

```SQL
CREATE VCLUSTER [IF NOT EXISTS] <name> 
VCLUSTER_TYPE=GENERAL 
MIN_VCLUSTER_SIZE=num 
MAX_VCLUSTER_SIZE=num;
```

* VCLUSTER\_SIZE、MIN\_VCLUSTER\_SIZE 和 MAX\_VCLUSTER\_SIZE 不能同时设置。

**4. comment**
指定计算集群的说明信息，最大支持1024个字符。

## 使用示例

1. 使用默认属性创建计算集群：

   ```SQL
   CREATE VCLUSTER sample_vc;
   ```

2. 指定创建通用型计算集群，XSMALL规格，自动启动，自动停止时间为60秒，作业最大执行时间为600秒：

   ```SQL
   CREATE VCLUSTER demo_gp_vcluster 
   VCLUSTER_SIZE = 1 
   VCLUSTER_TYPE = GENERAL 
   AUTO_SUSPEND_IN_SECOND = 60 
   AUTO_RESUME = TRUE 
   QUERY_RUNTIME_LIMIT_IN_SECOND = 600;
   ```

指定创建分析型计算集群，XSMALL规格，自动启动，自动停止时间为1分钟，最小实例数1，最大实例数2，每实例最大并发数为16，作业最大执行时间为600秒，预加载public.demo和billing.payment表的数据，每600秒拉取一次表数据缓存：

```
CREATE VCLUSTER demo_ap_vcluster 
VCLUSTER_SIZE = 1
VCLUSTER_TYPE = ANALYTICS
MIN_REPLICAS = 1
MAX_REPLICAS = 2
MAX_CONCURRENCY = 16
AUTO_SUSPEND_IN_SECOND = 60 
AUTO_RESUME = TRUE 
QUERY_RUNTIME_LIMIT_IN_SECOND = 600
PRELOAD_TABLES = 'public.demo,billing.payment';
```

^

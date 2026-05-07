# 计算集群管理

## 功能描述

本功能允许用户对指定的计算集群执行启动、停止、取消作业、修改属性配置和更新集群说明等操作。通过这些操作，用户可以灵活地管理计算资源，以满足不同的业务需求。

## 语法规范

```SQL
-- 启动计算集群
ALTER VCLUSTER [ IF EXISTS ] name RESUME ;

-- 停止计算集群
ALTER VCLUSTER [ IF EXISTS ] name SUSPEND [FORCE];

-- 取消计算集群中的所有作业
ALTER VCLUSTER [ IF EXISTS ] name CANCEL ALL JOBS;

-- 修改计算集群属性
ALTER VCLUSTER [ IF EXISTS ] name SET [ objectProperties ];
    --参数说明
        --修改分析型计算集群（ANALYTICS PURPOSE VIRTUAL CLUSTER）适用属性           
        objectProperties ::=
                    VCLUSTER_SIZE = num --1至256的整数 
                    MIN_REPLICAS = num
                    MAX_REPLICAS = num
                    AUTO_SUSPEND_IN_SECOND = num
                    AUTO_RESUME = TRUE| FALSE
                    MAX_CONCURRENCY = num
                    QUERY_RUNTIME_LIMIT_IN_SECOND = num
                    PRELOAD_TABLES = "<schema_name>.<table_name>[,<schema_name>.<table_name>,...]"
                    
            
        --修改通用型计算集群（GENERAL PURPOSE VIRTUAL CLUSTER）适用属性             
        objectProperties ::=
                    [VCLUSTER_SIZE = num | MIN_VCLUSTER_SIZE=num  MAX_VCLUSTER_SIZE=num] --1至256的整数
                    AUTO_SUSPEND_IN_SECOND = num
                    AUTO_RESUME = TRUE| FALSE
                    QUERY_RUNTIME_LIMIT_IN_SECOND = num
                    QUERY_RESOURCE_LIMIT_RATIO=num;


        --修改同步型计算集群（INTEGRATION VIRTUAL CLUSTER）适用属性             
        objectProperties ::=
                    [VCLUSTER_SIZE = num | MIN_VCLUSTER_SIZE=num  MAX_VCLUSTER_SIZE=num] --0.25，0.5及1至256的整数
                    AUTO_SUSPEND_IN_SECOND = num
                    AUTO_RESUME = TRUE| FALSE
                    QUERY_RUNTIME_LIMIT_IN_SECOND = num;


-- 修改计算集群的说明信息
ALTER VCLUSTER [ IF EXISTS ] name SET COMMENT '';
```

## 参数详解

**1. name**

指定计算集群的名称。

**2. objectProperties**

计算集群的属性配置，具体字段及说明如下：

| 字段名称                              | 字段含义                                                                                                                      | 取值范围                                                               | 默认值     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------- |
| VCLUSTER\_SIZE                    | 计算集群规格。支持从 1 CRU 到 256 CRU 的规格，算力依次加大。（同步型集群单独支持 0.25 CRU 和 0.5 CRU 两种小规格）                                                | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 1       |
| MIN\_VCLUSTER\_SIZE               | 仅通用型（GENERAL）集群适用。&#xA;计算集群弹缩时的最小规格，支持从1CRU -256 CRU的规格，需要小于等于MAX\_VCLUSTER\_SIZE参数。不可与VCLUSTER\_SIZE同时使用。                | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 无       |
| MAX\_VCLUSTER\_SIZE               | 仅通用型（GENERAL）集群适用。&#xA;计算集群弹缩时的最大规格，支持从1CRU -256 CRU的规格，需要大于等于MIN\_VCLUSTER\_SIZE参数。不可与VCLUSTER\_SIZE同时使用。                | 数字：1-256，单位为 CRU（Compute Resource Unit）。                           | 无       |
| VCLUSTER\_TYPE                    | 计算集群类型。&#xA;GENERAL：适用于数据摄取和ELT操作；&#xA;ANALYTICS：适用于对查询延迟和并发能力有强保障需求的场景。&#xA;INTEGRATION：用于数据集成任务场景。                      | GENERAL \| ANALYTICS \|INTEGRATION                                 | GENERAL |
| MIN\_REPLICAS                     | 计算集群最小实例数。仅适用于分析型计算集群。                                                                                                    | 1-10                                                               | 1       |
| MAX\_REPLICAS                     | 计算集群最大实例数。仅适用于分析型计算集群。                                                                                                    | 1-10                                                               | 1       |
| AUTO\_SUSPEND\_IN\_SECOND         | 集群自动关闭的空闲时长。单位：秒。                                                                                                         | 取值 -1或其他大于等于0的整数。                                                  | 600     |
| AUTO\_RESUME                      | 是否自动恢复。                                                                                                                   | TRUE\|FALSE                                                        | TRUE    |
| MAX\_CONCURRENCY                  | 计算集群中每个计算实例可负载的最大并发数。仅适用于分析型计算集群。                                                                                         | 1-32                                                               | 8       |
| QUERY\_RUNTIME\_LIMIT\_IN\_SECOND | 提交至该计算集群上的作业，可执行的最大时长。单位：秒。                                                                                               | 大于0的整数。                                                            | 86400   |
| PRELOAD\_TABLES                   | 计算集群可通过配置preload\_table，定时或被触发拉取preload\_table中指定的表数据到计算集群本地的SSD硬盘上进行缓存。您还可以在表上[设置缓存策略](create-table-ddl.md)。仅适用于分析型计算集群。 | schema\_name.table\_name，多个表名称之间用英文逗号分隔。支持通配符，例如：sample\_schema.\* | null    |
| QUERY\_RESOURCE\_LIMIT\_RATIO     | 单作业资源占比阈值：单个查询任务可使用的 CPU/内存资源不超过集群总资源的指定比例。                                                                               | `0.0` \~ `1.0`（如 `0.1` 表示10%）                                      | 1.0     |

> 注：计算集群的vcluster\_size参数同时支持以T-shirt size（XSMALL、SMALL、Large等）和以数字（1,2,4,16等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

**3. 修改时指定 GP 型 VC 的最大和最小值**

```SQL
ALTER VCLUSTER [IF  EXISTS] <name> 
SET MIN_VCLUSTER_SIZE=num 
MAX_VCLUSTER_SIZE=num;
```

## 使用示例

1. 启动名为sample\_vc的计算集群：

   ```SQL
   ALTER VCLUSTER sample_vc RESUME;
   ```

2. 停止名为sample\_vc的计算集群：

   ```SQL
   ALTER VCLUSTER sample_vc SUSPEND;
   ```

3. 强制停止名为sample\_vc的计算集群：

   ```SQL
   ALTER VCLUSTER sample_vc SUSPEND FORCE;
   ```

4. 取消名为sample\_vc的计算集群中的所有作业：

   ```SQL
   ALTER VCLUSTER sample_vc CANCEL ALL JOBS;
   ```

5. 修改名为sample\_vc的计算集群的规格大小为XSMALL：

   ```SQL
   ALTER VCLUSTER sample_vc SET VCLUSTER_SIZE='1';
   ```

6. 修改名为sample\_vc的计算集群的并发数量为4：

   ```SQL
   ALTER VCLUSTER sample_vc SET MAX_CONCURRENCY = 4;
   ```

7. 修改名为sample\_vc的计算集群的说明信息：

   ```SQL
   ALTER VCLUSTER sample_vc SET COMMENT '这是一个示例计算集群';
   ```

^

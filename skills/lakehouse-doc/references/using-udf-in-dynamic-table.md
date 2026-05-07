# 动态表中使用UDF
>【预览发布】本功能当前处于公开预览阶段。


动态表扩展了对用户自定义函数的支持。您可以在动态表 DDL 的 SELECT 子句中使用 External Function 创建的自定义函数（包括 UDF、UDAF、UDTF），在刷新时系统将进行自动增量计算优化。

关于如何使用 External Function 开发自定义函数，请参考《自定义函数开发指南》。

## 使用示例

### 动态表使用UDF

在预览阶段，动态表开启 UDF 增量计算支持。在创建和刷新动态表时，需设置如下参数：

```SQL
-- 使用自定义的UDF的时候需要添加下面的flag
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
```

示例说明：

```SQL
 /*  1.动态表对UDF的增量计算支持  */
-- step01: 测试运行UDF
SELECT public.upper_udf('clickzetta')  as upper_string;

upper_string 
------------ 
CLICKZETTA   


--step02: 创建使用UDF的动态表
-- 使用自定义的UDF的时候需要添加下面的flag,创建时一共执行
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
create or replace dynamic table public.dt_udf_on_demand
refresh
    vcluster default
as
SELECT public.upper_udf(event_type) as event_type
FROM ecommerce_events_multicategorystore_live ;

--执行动态表刷新，与参数设置一共执行
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
REFRESH DYNAMIC TABLE public.dt_udf_on_demand;

--查看刷新历史，首次全量刷新，第2次增量刷新
SHOW DYNAMIC TABLE REFRESH HISTORY WHERE NAME='dt_udf_on_demand';

workspace_name schema_name name             virtual_cluster start_time          end_time            duration             state   refresh_trigger suspended_reason refresh_mode error_message source_tables                                                                                     stats                                      completion_target job_id                        
-------------- ----------- ---------------- --------------- ------------------- ------------------- -------------------- ------- --------------- ---------------- ------------ ------------- ------------------------------------------------------------------------------------------------- ------------------------------------------ ----------------- ----------------------------- 
ql_ws          public      dt_udf_on_demand DEFAULT         2024-06-08 14:38:56 2024-06-08 14:38:56 0 00:00:00.613000000 SUCCEED MANUAL          (null)           INCREMENTAL  (null)        [{"schema":"public","table_name":"ecommerce_events_multicategorystore_live","workspace":"ql_ws"}] {"rows_deleted":"0","rows_inserted":"50"}  (null)            202406080638559284o0jorqp9tvp 
ql_ws          public      dt_udf_on_demand DEFAULT         2024-06-08 14:37:00 2024-06-08 14:37:00 0 00:00:00.529000000 SUCCEED MANUAL          (null)           FULL         (null)        [{"schema":"public","table_name":"ecommerce_events_multicategorystore_live","workspace":"ql_ws"}] {"rows_deleted":"0","rows_inserted":"100"} (null)            202406080637000414o0jorqp9uf0 
```

### 动态表使用UDAF

在预览阶段，动态表开启 UDAF 增量计算支持。在创建和刷新动态表时，需设置如下参数：

```SQL
-- 使用自定义的UDAF的时候需要添加下面的flag
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
set cz.optimizer.mv.auto.unique.key.enabled=true;
set cz.common.table.enable.hidden.row.key=true;
set cz.optimizer.incremental.extra.recompute.agg.func=<your_udaf_function_name>; --替换为您创建的udaf名称
```

示例说明：

```SQL
-- step01: 测试运行UDAF
SELECT public.udaf_sum(c1)  as sum from values (1),(2),(3);
sum 
--- 
6   

--step02: 创建使用UDAF的动态表
-- 使用自定义的udaf的时候需要添加下面的flag
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
set cz.optimizer.mv.auto.unique.key.enabled=true;
set cz.common.table.enable.hidden.row.key=true;
set cz.optimizer.incremental.extra.recompute.agg.func=udaf_sum; --  改成自己的udaf名字
CREATE OR REPLACE DYNAMIC TABLE public.DT_UDAF_ON_DEMAND
refresh
    vcluster default
AS
SELECT EVENT_TYPE , public.UDAF_SUM(CAST(PRICE AS INT)) AS REVENUE
FROM ECOMMERCE_EVENTS_MULTICATEGORYSTORE_LIVE 
GROUP BY EVENT_TYPE;

--step03: 执行动态表刷新，与参数设置一共执行
set cz.sql.mv.support.udf=true;
set cz.optimizer.incremental.enable=true;
set cz.optimizer.mv.auto.unique.key.enabled=true;
set cz.common.table.enable.hidden.row.key=true;
set cz.optimizer.incremental.extra.recompute.agg.func=udaf_sum; --  改成自己的udaf名字
REFRESH DYNAMIC TABLE public.DT_UDAF_ON_DEMAND;

--step04: 查看刷新历史
SHOW DYNAMIC TABLE REFRESH HISTORY WHERE NAME='dt_udaf_on_demand';
```

### 动态表使用UDTF

在预览阶段，动态表开启 UDTF 增量计算支持。在创建和刷新动态表时，需设置如下参数：

```SQL
-- 使用自定义的UDTF的时候需要添加下面的flag
set cz.sql.remote.udf.trace.enabled=true;
set cz.sql.mv.support.udf=true;
set cz.common.table.enable.hidden.row.key=false;
set cz.optimizer.incremental.condense.by.version.enable=false;
set cz.optimizer.mv.auto.unique.key.enabled=false;
set cz.optimizer.incremental.extra.recompute.table.func=<your_udtf_function_name>; --替换为您创建的udaf名称
```

示例说明：

```SQL
-- step01: 测试运行UDTF
SELECT public.myexplode(array('a','b','c')) as col_name;
col_name 
----- 
a     
b     
c     

--step02: 创建使用UDTF的动态表
-- 使用自定义的udtf的时候需要添加下面的flag,同时执行
set cz.sql.remote.udf.trace.enabled=true;
set cz.sql.mv.support.udf=true;
set cz.common.table.enable.hidden.row.key=false;
set cz.optimizer.incremental.condense.by.version.enable=false;
set cz.optimizer.mv.auto.unique.key.enabled=false;
set cz.optimizer.incremental.extra.recompute.table.func=myexplode; --  改成自己的udtf名字
CREATE OR REPLACE DYNAMIC TABLE public.DT_UDTF_ON_DEMAND
refresh
    vcluster default
AS
SELECT public.MYEXPLODE(ARRAY(PRICE::STRING,'1000')) AS PRICE
FROM ECOMMERCE_EVENTS_MULTICATEGORYSTORE_LIVE ;

----step03: 刷新带UDTF的动态表,同时执行
set cz.sql.remote.udf.trace.enabled=true;
set cz.sql.mv.support.udf=true;
set cz.common.table.enable.hidden.row.key=false;
set cz.optimizer.incremental.condense.by.version.enable=false;
set cz.optimizer.mv.auto.unique.key.enabled=false;
set cz.optimizer.incremental.extra.recompute.table.func=myexplode; 
REFRESH DYNAMIC TABLE public.DT_UDF_ON_DEMAND;

--step04: 查看刷新历史
show dynamic table refresh history where name='dt_udtf_on_demand';
```

# 约束与限制

功能预览期间，暂不支持在动态表的 DDL 中设置调度刷新时使用 UDF（及相关自定义函数）。如有需要，可联系平台技术团队。

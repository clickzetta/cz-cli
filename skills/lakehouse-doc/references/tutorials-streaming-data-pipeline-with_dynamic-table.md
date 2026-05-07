# 使用DynamicTable开展实时ETL

## 教程概述

通过本教程，您将了解如何使用 Lakehouse 动态表（Dynamic Table）对流式数据进行实时 ETL。

本教程包含以下步骤：

* 环境准备：通过样例数据集获取系统预置的实时数据表
* 创建 ETL 任务：通过 Dynamic Table 分别构造数据清洗、数据聚合的加工流程
* 验证加工结果：查看消费层数据表的变化情况，验证实时数据加工结果

## Step 1. 准备工作

本教程将利用 Lakehouse 样例数据集中具备实时数据的表作为数据源表（阿里云上海区域可用），同时创建一个用于测试的计算集群和一个测试用的 schema，用于保存 ETL 过程中产生的数据表。

```sql
--  1.计算资源和DEMO环境准备
create vcluster if not exists dt_refresh_vc vcluster_size='XSMALL' vcluster_type='GENERAL';

USE vcluster dt_refresh_vc;

CREATE SCHEMA cz_tutourials;
use cz_tutourials;

-- 2.查看原始数据：样例数据集ecommerce_events_multicategorystore_live提供实时电商行为样例数据
select * from clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live
where event_time between current_timestamp() - INTERVAL 5 minutes and current_timestamp() limit 20;
```

查看原始数据明细，可以看到表 `ecommerce_events_multicategorystore_live` 持续有实时数据插入。
![](.topwrite/assets/image_1716287777109.png)

## Step 2.通过定义动态表实现数据清洗

参考如下语句创建动态表 `ecommerce_events_multicategorystore_enriched`。该动态表将每分钟刷新一次，对每分钟的增量数据进行数据清洗转换。为了减少加工数据规模，对历史数据进行过滤，仅处理指定时间之后的新增数据。

刷新任务将根据 DDL 中定义的刷新间隔自动运行，并使用 `refresh_vc` 指定的计算资源执行。

```sql

-- 以当前时间（以当前时间替换下方时间过滤条件，过滤规则可选）作为原始表过滤条件，创建包含数据清洗逻辑的物化视图,配置分钟级别调度
CREATE DYNAMIC TABLE IF NOT EXISTS ecommerce_events_multicategorystore_enriched
REFRESH
    interval '1' minute
    vcluster dt_refresh_vc
AS
SELECT
event_time,
CAST(SUBSTRING(event_time,0,19) AS TIMESTAMP) AS event_timestamp, 
SUBSTRING(event_time,12,2) AS event_hour, 
SUBSTRING(event_time,15,2) AS event_minute, 
SUBSTRING(event_time,18,2) AS event_second, 
event_type,
product_id, 
category_id,
category_code,
brand,
CAST(price AS DECIMAL(10,2)) AS price, 
user_id, 
user_session,
CAST(SUBSTRING(event_time,0,19)AS date) AS event_date 
FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live
where event_time > TIMESTAMP '2024-05-21 18:18:35.117561';
refresh DYNAMIC TABLE ecommerce_events_multicategorystore_enriched;
```

## Step 3.通过定义动态表实现数据聚合分析

根据业务需求，这里模拟对表 `ecommerce_events_multicategorystore_enriched` 进行产品收入、转化率、DAU 等主题的数据聚合加工。

```sql
-- 分析指标加工
-- 产品收入分析,配置分钟级别调度
CREATE DYNAMIC TABLE IF NOT EXISTS Product_Grossing
REFRESH
    interval '1' minute
    vcluster dt_refresh_vc
AS 
select event_date,product_id,sum(price) sum_price from ecommerce_events_multicategorystore_enriched
group by event_date,product_id;
refresh DYNAMIC TABLE Product_Grossing;

--产品的转化率  Conversion Rates Per Product,配置分钟级别调度
CREATE DYNAMIC TABLE IF NOT EXISTS Conversion_Rates_Per_Product
REFRESH
    interval '1' minute
    vcluster dt_refresh_vc
AS
select event_date,product_id,
count(case when event_type='purchase' then 1 else null end) num_of_sales,
count(case when event_type='view' then 1 else null end) num_of_views,
count(case when event_type='purchase' then 1 else null end)/count(case when event_type='view' then 1 else null end) cvr
from ecommerce_events_multicategorystore_enriched
GROUP BY event_date,product_id;
refresh DYNAMIC TABLE Conversion_Rates_Per_Product;
--日活跃用户(DAU),配置分钟级别调度
CREATE DYNAMIC TABLE IF NOT EXISTS DAU
REFRESH
    interval '1' minute
    vcluster dt_refresh_vc
AS
select event_date,count(distinct user_id) as DAU from ecommerce_events_multicategorystore_enriched  
group by event_date;
refresh DYNAMIC TABLE DAU;
```

## Step 4.验证实时ETL加工结果

上述动态表在创建后，平台将自动进行调度刷新。当源头表有新数据写入时，最终加工出的聚合表将自动按照聚合逻辑进行更新。

```sql
-- 查询分析
-- 当日收入前10产品分析
select product_id,sum_price as revenue from Product_Grossing where event_date=CURRENT_DATE() order by sum_price desc limit 10;
-- 当日转化率前10产品分析
SELECT product_id,cvr FROM Conversion_Rates_Per_Product WHERE event_date=CURRENT_DATE() order by cvr desc limit 10;
-- 当日DAU
SELECT EVENT_DATE,DAU FROM DAU WHERE event_date=CURRENT_DATE();
```





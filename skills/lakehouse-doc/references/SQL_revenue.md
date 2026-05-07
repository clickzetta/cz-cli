## 使用SQL任务计算客户留存指标

留存率是企业用来衡量产品/服务的一个重要指标，留存率的高低代表了用户对产品/服务的满意程度，也是数据分析领域中最常使用的分析模型之一。

本文介绍了如何使用SQL任务创建留存分析查询。

本教程中，我们将基于《电商数据集》进行留存率分析。所使用的数据来自云器Lakehouse的共享样例数据，可以直接按照如下方式使用：

```
select * from clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore  limit 10;
```

```SQL
DROP TABLE if exists ecommerce_Retention_Week_Number;
CREATE TABLE ecommerce_Retention_Week_Number 
AS
SELECT a.user_id,
       a.event_week,
       b.first_week AS first_week,
       a.event_week-first_week as week_number 
FROM (SELECT user_id,
             weekofyear(event_date) AS event_week
      FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore
      GROUP BY user_id,
               event_week) a,
     (SELECT user_id,
             MIN(weekofyear (event_date)) AS first_week
      FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore
      GROUP BY user_id) b
WHERE a.user_id = b.user_id;
```

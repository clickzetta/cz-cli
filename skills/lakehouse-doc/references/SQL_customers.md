## 使用SQL任务计算新客户、活跃客户和流失客户

在企业运营中，通常会基于用户行为特征将用户进行分层，针对不同分层的用户针对性的做一些运营动作，针对性的做用户转化。大多数场景下，会将用户划分为新客户、活跃客户以及流失用户。

* 新用户：是指在特定时间段内新注册成为用户的数量，通常用于衡量用户增长的速度和吸引力。
* 活跃用户：是指在特定时间段内有实际使用行为的用户数量，通常用于衡量用户参与度和留存情况。
* 流失用户：是指在特定时间段内不在访问产品的用户。企业要尽可能减少流失用户的占比，减少唤起用户的成本。

本教程中，我们将基于「电商数据集」，进行留存率的分析。所使用的数据来自云器Lakehouse的共享样例数据，可以直接按照如下方式直接使用:
```
select * from clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore limit 10;
```

### 第一步：根据每个客户的升序订单日期创建特定于每个客户 ID 的订单序列列。

```SQL
DROP TABLE if exists eCommerce_LifeCycle_Order_Sequence;
CREATE TABLE eCommerce_LifeCycle_Order_Sequence 
AS
SELECT event_date,
       user_id,
       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_date ASC) AS customer_order_sequence,
       LAG(event_date) OVER (PARTITION BY user_id ORDER BY user_id ASC) AS previous_order_date,
       MIN(event_date) AS first_order_date,
       MAX(event_date) AS last_order_date
FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore
WHERE event_type = 'purchase'
GROUP BY event_date,
         user_id;
```

### 第二步：创建一个新列，为客户 ID 插入先前的订单日期，以便在以后的代码块中用于计算订单之间的时间段

```SQL
DROP TABLE if exists eCommerce_LifeCycle_Time_Between_Orders;
CREATE TABLE eCommerce_LifeCycle_Time_Between_Orders 
AS
SELECT event_date,
       user_id,
       customer_order_sequence,
       CASE
         WHEN previous_order_date IS NULL THEN event_date
         ELSE previous_order_date
       END AS previous_order_date,
       DATEDIFF(event_date,previous_order_date) AS days_between_orders,
       first_order_date,
       last_order_date
FROM eCommerce_LifeCycle_Order_Sequence;
```

### 第三步：使用CASE 语句创建一个附加的 customer\_life\_cycle 列，以根据 days\_between\_orders 列指示订单是来自新客户、活跃客户还是已失效客户。在此示例中，如果订单发生在距上一个订单 1 到 365 天之间的任何时间，则客户被视为活跃客户；如果先前订单超过 365 天，则客户被视为已失效。

```SQL
DROP TABLE if exists eCommerce_LifeCycle;
CREATE TABLE eCommerce_LifeCycle 
AS
SELECT event_date,
       user_id,
       CASE
         WHEN customer_order_sequence = 1 THEN '新客户'
         WHEN days_between_orders > 0 AND days_between_orders < 30 THEN '活跃客户'
         WHEN days_between_orders > 30 THEN '沉睡客户'
         ELSE '未知'
       END AS customer_life_cycle,
       customer_order_sequence,
       previous_order_date,
       CASE
         WHEN days_between_orders IS NULL THEN 0
         ELSE days_between_orders
       END AS days_between_orders,
       first_order_date,
       last_order_date
FROM eCommerce_LifeCycle_Time_Between_Orders;
```

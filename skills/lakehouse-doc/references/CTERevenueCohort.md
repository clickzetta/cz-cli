# 用CTE方式对客户进行同类群组分析

## CTE

[CTE(Common Table Expression) ](WITH.md)，公用表表达式，它是在单个语句的执行范围内定义的临时结果集，只在查询期间有效。它可以自引用，也可在同一查询中多次引用，实现了代码段的重复利用。

## 同类群组（Revenue Cohort）

同类群组（Revenue Cohort）分析是对几个不同同类群组（即客户群）的分析，以更好地了解行为、模式和趋势。
最常见的同类群组分析类型之一着眼于基于时间的同类群组，这些群组按特定时间范围对用户/客户进行分组。例如，一家公司可能希望了解其在 1 月份开始使用该产品或开始付款的客户与 2 月份的客户相比如何。
基于细分的群组代表使用或购买特定产品或服务的客户群。例如，您可以根据用户每周登录您的应用的时间来细分用户。
另一种类型的群组是基于规模的群组，它按货币价值对客户进行细分。这是游戏行业（免费用户与鲸鱼用户）或 SaaS 世界中的常见做法，通过他们的 LTV 或计划对客户进行细分。
对于本文的其余部分，我们将只关注实施基于时间的收入群组分析。
队列分析所需的数据，在开始队列分析之前，需要以下数据：
\*     与购买数据相关联的收入数据
\*     用户的唯一标识符，例如客户 ID 或帐户 ID
\*     每个用户的初始开始日期，无论是注册日期还是第一次付款。

## 数据说明

本文所使用的数据来自云器Lakehouse的共享样例数据，可以直接按照如下方式直接使用:

```
select * from clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore limit 10;
```

![](.topwrite/assets/image_1718761578596.png)

## 分析步骤

1. 临时结果集user\_cohorts：首先，我们想将用户分到群组中——在这种情况下，我们想按他们的Order Week 。
2. 临时结果集order\_Week：接下来我们要创建一个order\_month变量。例如，客户在首次付款后一个月进行的付款的值为order\_month2。创建一个order\_Week变量。例如，客户在首次付款后一周进行的付款的order\_Week值为 2。
3. 临时结果集cohort\_size：进一步，我们现在可以汇总cohortMonth第一步中创造的收入。这将使我们能够创建我们的rentention\_table.汇总cohortMonth第一步中创造的收入。这将使我们能够创建我们的rentention\_table.
   构建分析模型如下：

```
WITH 
eCommerce_LifeCycle_Order_Sequence AS (
SELECT event_date,
       user_id,
       ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_date ASC) AS customer_order_sequence,
       LAG(event_date) OVER (PARTITION BY user_id ORDER BY user_id ASC) AS previous_order_date,
       MIN(event_date) AS first_order_date,
       MAX(event_date) AS last_order_date
FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore
WHERE event_type = 'purchase'
GROUP BY event_date,
         user_id)
,
eCommerce_LifeCycle_Time_Between_Orders AS (
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
FROM eCommerce_LifeCycle_Order_Sequence)
,
eCommerce_LifeCycle AS(
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
FROM eCommerce_LifeCycle_Time_Between_Orders)
select * from eCommerce_LifeCycle;
```

运行上述SQL代码，结果如下：
![](.topwrite/assets/image_1718761957078.png)

也可以通过以下方式，可以将结果直接写入到目标表中：

```
DROP TABLE if exists eCommerce_User_Cohort;

CREATE TABLE if not exists eCommerce_User_Cohort

AS

--将用户分到群组中。在本例中，我们想按他们的Order Date

with user_cohorts as (

SELECT user_id

, MIN(weekofyear(event_date)) as cohortWeek

FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore

WHERE CAST(event_type as string) = 'purchase'

GROUP BY 1

--LIMIT 100

),

--创建一个order_Week变量。例如，客户在首次付款后一周进行的付款的order_Week值为 2。

order_Week as (

SELECT eed.user_id

, (weekofyear(event_date)-cohortWeek+1) as Week_number

, SUM(price) as revenue

FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore eed

LEFT JOIN user_cohorts u on eed.user_id=u.user_id --USING(user_id)

WHERE CAST(event_type as string) = 'purchase'

GROUP BY 1, 2

--LIMIT 100

),

--汇总cohortMonth第一步中创造的收入。这将使我们能够创建我们的rentention_table.

cohort_size as (

SELECT sum(price) as revenue

, cohortWeek

FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore eed

LEFT JOIN user_cohorts u on eed.user_id=u.user_id --USING (user_id)

WHERE CAST(event_type as string) = 'purchase'

GROUP BY 2

ORDER BY 2

--LIMIT 100

),

retention_table as (

SELECT c.cohortWeek

, o.Week_number

, sum(revenue) as revenue

FROM order_Week o

LEFT JOIN user_cohorts c on c.user_id=o.user_id 

GROUP BY 1, 2

)

SELECT r.cohortWeek

, s.revenue as totalRevenue

, r.Week_number

, r.revenue / s.revenue as percentage

FROM retention_table r

LEFT JOIN cohort_size s on r.cohortWeek=s.cohortWeek 

WHERE r.cohortWeek IS NOT NULL

ORDER BY 1, 3;

```

## 回顾：物理表的方式

不使用CTE，而是将每一个子查询的结果都落成物理表，则整个处理过程如下：

1. 根据每个客户的升序订单日期创建特定于每个客户 ID 的订单序列列。这就是ROW\_NUMBER 分析函数在下面的查询中所做的。
2. 创建一个新列，为客户 ID 插入先前的订单日期，以便在以后的代码块中用于计算订单之间的时间段。这就是LAG 分析函数在以下查询中所做的。
   –请注意语句末尾的“Group By”order\_date 和 customer\_id 列。这很重要，因为客户可以在同一天拥有多个具有不同订单 ID 的订单。

```
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

针对上表运行子查询以计算 order\_date 和 previous\_order\_date 列之间的天数，您将看到创建新列 days\_between\_orders 的 DATE\_DIFF 函数会发生这种情况。

```
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

下一个查询使用CASE 语句创建一个附加的 customer\_life\_cycle 列，以根据 days\_between\_orders 列指示订单是来自新客户、活跃客户还是已失效客户。在此示例中，如果订单发生在距上一个订单 1 到 365 天之间的任何时间，则客户被视为活跃客户；如果先前订单超过 365 天，则客户被视为已失效。这具有高度的业务特定性，因此您的可能会有所不同。

```
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

```
select * from eCommerce_LifeCycle limit 100;
```

## Congratulations, it's done.

Please enojoy and learn more!

## 附录

### 下载Zeppelin Notebook源文件

本文代码也提供运行在[Zeppelin](eco_integration/Zeppelin.md)的版本，你如果想直接运行本文代码，请按照文档说明安装[Zeppelin](eco_integration/Zeppelin.md)。

[03.CTE(Common Table Expression)..ipynb](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/03.CTE\(Common%20Table%20Expression\)..ipynb)
[03.CTE(Common Table Expression)\_2JHUJ5BP8.zpln](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/zeppelin_notebook/03.CTE\(Common%20Table%20Expression\)_2JHUJ5BP8.zpln)

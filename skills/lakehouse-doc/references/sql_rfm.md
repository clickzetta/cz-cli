# 使用SQL对客户进行RFM分析
# # **什么是 RFM 分析？**
**RFM 报告**是一种使用三个关键指标对客户进行细分的方法：新近度（他们上次购买是在多长时间前）、频率（他们购买的频率）和货币价值（他们花了多少钱）。

**RFM 分析**基于这样的假设，即最近从您那里购买过的客户更有可能再次购买这一原则适用于各种行业，有证据表明，与不经常购买或消费较少的客户相比，频繁购买者和大手笔消费者更有可能对促销活动做出反应。

**RFM**创建于上世纪 90 年代，旨在提高直邮营销活动的效率，它利用[**帕累托原理**](https://mode.com/blog/pareto-chart-101/)来回答关键问题，例如：

* 谁是我最好或最忠诚的客户？
* 我有失去哪些客户的危险？
* 我应该将营销工作重点放在哪些客户身上？
* 我可以吸引哪些客户花更多钱？

**这种客户分析会对您的业务产生巨大影响** 无论您是想提高营销 ROI、建立忠诚度、减少客户流失还是增加CLV，RFM 分析都是朝着正确方向迈出的一步。

一旦您有了包含每个客户的新近度（R）、频率（F）和货币价值（M）数据的表格，就可以开始细分了。虽然您可以根据需要对数据进行精细分割，但使用五分位数反映了帕累托原则，它表明您的哪些客户在所有三个指标中都处于前 20%。
要创建五分位数，我们将使用一个ntile窗口函数，它只需要在原始RFM 值查询的顶部添加几行额外的 SQL 。
##  **如何为数据创建 RFM 报告**

因为它只关注三个指标，RFM 报告看似简单。例如，在对 数据 进行 RFM 分析时，您真正需要的只是三个数据点：

* **新近度（R，recency）**- 最后订购日期
* **频率（F，frequency）**- 订单总数
* **货币价值（M，monetary）**- 总支出

**这些指标共同揭示了您的回头客是谁，哪些客户随着时间的推移最忠诚，以及哪些客户在您的商店中花费最多**。 RFM 报告提供有关您的客户的重要信息，虽然 RFM 与 B2C 和零售密切相关，但对于 B2B、服务或 SaaS 企业来说，它是更好地了解其客户的同样有效的方式。

## 数据说明
本文所使用的数据来自云器Lakehouse的共享样例数据，可以直接按照如下方式直接使用:
```
select * from clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore limit 10;
```
![](.topwrite/assets/image_1718761578596.png)

## 创建RFM需要的值
```
DROP TABLE if exists eCommerce_RFM_Values;

CREATE TABLE eCommerce_RFM_Values

AS

SELECT user_id,

MIN(event_date) AS first_order_date,

MAX(event_date) AS last_order_date,

COUNT(1) AS count_order,

sum(price) AS sum_amount

FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore

WHERE event_type = 'purchase'

GROUP BY user_id

ORDER BY user_id;
```
## 创建RFM Quintiles
本文为了简单演示，用了两分位（ntile(2)，而不是ntile(5)）。此查询返回一个表，其中包含客户电子邮件以及每个客户在新近度、频率和货币价值方面所属的二分位数。从新近度来看，2 表示客户的购买在最近的前 50% 内，而 1 表示客户在后 50% 内。
```
DROP TABLE if exists eCommerce_RFM_Quintiles;

CREATE TABLE eCommerce_RFM_Quintiles

AS

SELECT user_id,

ntile(2) OVER (ORDER BY last_order_date) AS rfm_recency,

ntile(2) OVER (ORDER BY count_order) AS rfm_frequency,

ntile(2) OVER (ORDER BY sum_amount) AS rfm_monetary,

first_order_date,

last_order_date,

count_order,

sum_amount

FROM eCommerce_RFM_Values

ORDER BY user_id;
```
## 创建 RFM 单元
现在您知道了您的客户通常属于哪里，让我们使五分位数数据更易于使用。最常见的方法是将每个指标的五分位等级连接起来，以创建一个3 位数，也称为“单元格”。
以这种方式连接数据时，最佳客户的单元格值为 222（五分位则为555），因为他们在所有三个指标中都处于前 50%，而在所有三个指标中处于后 50% 的客户的单元格值为 111 .
```
DROP TABLE if exists eCommerce_RFM_Cell;
CREATE TABLE eCommerce_RFM_Cell

AS

SELECT user_id,

rfm_recency,

rfm_frequency,

rfm_monetary,

rfm_recency || rfm_frequency || rfm_monetary AS rfm_cell,

first_order_date,

last_order_date,

count_order,

sum_amount

FROM eCommerce_RFM_Quintiles

ORDER BY user_id;
```
## 创建可操作的 RFM Segment

现在您已经有了清晰的 RFM 单元，您需要创建有意义的分组，以帮助将数据转化为可操作的见解。通过三个指标和每个指标的五个层级，您可以创建多达 125 (5x5x5) 个客户群。如果 125 段的想法让您头疼，请考虑使用四分位数（这会给您 4x4x4 = 64 个段）甚至三分之一（3x3x3 = 27 个段）来简化事情。

如何划分细分市场取决于您的业务性质。如果您是 Pareto 的铁杆粉丝，想要奖励您的最佳购买者，您可能希望关注 RFM 单元格为 555 的客户。但是，如果您想要稍微开放一些，以包括最近和常客，他们可能有花费少一点，您可以创建一个细分，其中包含 RFM 单元格值为 555 和 554 的每个人。

创建客户细分时的关键是使存储桶足够大以便于采取行动——如果营销人员认为他们需要创建 125 个单独的客户营销活动，他们就会失去理智——但又要小到你可以将它们作为一个整体来处理。

创建客户细分时的关键是使存储桶足够大以便于操作，但又要足够小以便您可以将它们作为一个组来处理。
```
DROP TABLE if exists eCommerce_RFM_Segment;

CREATE TABLE eCommerce_RFM_Segment

AS

SELECT user_id AS rfm_user_id,

rfm_recency,

rfm_frequency,

rfm_monetary,

rfm_recency || rfm_frequency || rfm_monetary AS rfm_cell,

CASE

WHEN rfm_cell IN ('111') THEN '一般挽留客户111'

WHEN rfm_cell IN ('112') THEN '重要挽留客户112'

WHEN rfm_cell IN ('121') THEN '一般保持客户121'

WHEN rfm_cell IN ('122') THEN '重要保持客户122'

WHEN rfm_cell IN ('211') THEN '一般发展客户211'

WHEN rfm_cell IN ('212') THEN '重要发展客户212'

WHEN rfm_cell IN ('221') THEN '一般价值客户221'

WHEN rfm_cell IN ('222') THEN '重要价值客户222'

ELSE 'Other'

END AS rfm_segment,

first_order_date as rfm_first_purchase_date,

last_order_date as rfm_last_purchase_date,

count_order as rfm_purchase_count,

sum_amount as rfm_purchase_amount_sum

FROM eCommerce_RFM_Cell

ORDER BY rfm_user_id;
```


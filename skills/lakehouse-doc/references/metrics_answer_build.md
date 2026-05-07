# 指标、答案构建器配置

## 构建指标：

在**左侧导航栏：数据** -> **指标** 中，可以点击 “+ **新建指标**” ，添加新的指标。支持聚合与自定义代码方式生成指标。

![](.topwrite/assets/b.jpg =558)

^

## 创建答案构建器：

答案构建器用于定义有复杂计算逻辑的指标，以及回答明细查询的 SQL 模板。在**左侧导航栏：数据** -> **答案构建器** 中，可以点击 “+ **新建答案构建器**” ，按步骤填写代码。

* 答案构建器的 SQL 模板：其中 `${dims} `和 `${filters}` 为固定写法，代表维度与过滤条件的变量，变量可选的列在模板下方的过滤条件与维度的选择区域 **Filters** 和 **Dims** 部分定义

```SQL
SELECT  
  ${dims},
  sum(op.payment_value) as total_sales_bz,
  avg(op.payment_value) as avg_sales_bz
FROM datagpt_ws.public.v_gpt_orders AS o  
LEFT JOIN datagpt_ws.public.v_gpt_order_items AS oi 
    ON o.order_id = oi.order_id  LEFT JOIN datagpt_ws.public.v_gpt_products AS p
    ON oi.product_id = p.product_id  LEFT JOIN datagpt_ws.public.v_gpt_customers AS c
    ON o.customer_id = c.customer_id  LEFT JOIN datagpt_ws.public.v_gpt_payments AS op
    ON o.order_id = op.order_id  LEFT JOIN datagpt_ws.public.v_gpt_sellers AS os ON oi.seller_id = os.seller_id
where ${filters}
group by ${dims}
```

* **Filters 与Dims 变量定义**：注：此处未出现在 Filter 和 Dims 中的列，不会作为问题的过滤条件和维度。（此处与 **数据** -> **数据表** 中，表列的**用途**字段配置关联：即在**用途**字段中被配置为 FILTER 和 DIM 的列，会在此处默认被选中，最终以此页面的配置为准）
* ![](.topwrite/assets/c.jpg =601)

### 配置指标别名和分析方法：

一个指标模板中，可以定义多个指标。每个指标可以指定多个别名。

> 注意：在系统 Default Domain （默认域）中，允许指标以及别名重复；在其它用户创建的 Domain 中，不允许指标名称（包括别名）重复

### **分析方法**：

* **可加型指标**：同环比的算法为：（本期值-上期值）/ 上期值的绝对值
* **比例型指标**：同环比的算法为：本期值 - 上期值。例如今年市场占有率30%，去年20%，那就是同比增长10%。

![](.topwrite/assets/f.jpg =671)

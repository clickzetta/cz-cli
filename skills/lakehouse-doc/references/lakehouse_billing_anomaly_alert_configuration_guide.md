^

# 云器Lakehouse费用异常告警配置指南

## 概述

本指南帮助您快速配置费用异常监控系统，实现费用突增时的自动告警，保障您的成本安全。

## 前置条件

* 拥有 instance_admin 角色权限，用于查询 sys.information_schema.instance_usage 视图中的费用数据。
* 拥有 instance_sre 角色权限，用于使用“数据质量”和“监控告警”功能。
* 具备某一工作空间内计算集群的使用权限（用于执行质量规则查询 SQL）和某一表或视图的元数据查询（read metadata）权限（用于配置质量规则）。

## 使用数据

sys.information_schema.instance_usage 视图的字段和内容介绍可见于文末附录。

## 配置步骤

### 步骤1：创建数据质量规则

1\. 进入**数据质量管理**模块

2\. 点击**创建质量规则**

:-: ![](.topwrite/assets/image_1760009305873.png =804)

^

3\. 填写基本信息：

:-:
![](.topwrite/assets/image_1760009346751.png =793)

在本案例中主要关注以下三个选项：
1) 校验方式：选择“自定义 SQL”；
2) 根据本文建议的规则，直接将 SQL 粘贴到文本框中；
3) 在“期待结果”中，根据所选择的规则配置对应的预期条件和值。

其他字段配置可详见数据质量的完整配置文档：[数据质量](https://www.yunqi.tech/documents/DataQuality)

### 步骤2：配置监控告警

1\. 进入**监控告警**模块，点击“**新建规则**”

:-: ![](.topwrite/assets/image_1760009359793.png =776)

2\. 配置告警规则

在本案例中主要关注以下3个选项：

1) 监控事项：选择 **数据质量监控失败** 告警，并 **添加过滤条件**，以有效过滤掉其他质量规则，避免因其他质量规则校验失败而产生的干扰。

2) 通知策略：根据实际需要选择所需的通知策略，也可单独新建一条通知策略。通知策略的相关配置可参考文档：[监控告警系统](https://www.yunqi.tech/documents/monitoring_and_alerting)。

3) 通知人员：选择关注费用的相关人员。可以通过在账户中心新建用户，将需要通知的用户添加到此列表中。

:-: ![](.topwrite/assets/image_1760009490281.png =640)

完成上述两步配置，即完成了从监控到告警的完整流程。当质量规则监控到异常时，您将通过对应渠道收到告警信息。

下面具体说明在数据质量规则中，可供选择的监控规则。

## 监控方案

### 方案一：固定阈值监控（简单快速）

**适用场景**：费用相对稳定，有明确的预算上限。

**监控SQL**：

```SQL
-- 查询昨日总费用
SELECT
  ROUND(SUM(COALESCE(total_after_discount, amount * discount_rate)), 2) AS total_amount
FROM sys.information_schema.instance_usage
WHERE CAST(SUBSTR(measurement_start, 1, 10) AS DATE) = current_date() - INTERVAL 1 DAY
```

**告警配置**：
* 预期结果 ≤ 50（根据实际调整阈值）
* 超过阈值则触发告警

**阈值参考查询**：

```SQL
-- 查询过去90天的费用参考值
WITH day_sum AS (
  SELECT
    CAST(SUBSTR(measurement_start, 1, 10) AS DATE) AS bill_date,
    SUM(COALESCE(total_after_discount, amount * discount_rate)) AS day_amount
  FROM sys.information_schema.instance_usage
  WHERE CAST(SUBSTR(measurement_start, 1, 10) AS DATE) BETWEEN 
    date_sub(current_date(), 90) AND current_date() - INTERVAL 1 DAY
  GROUP BY 1
)
SELECT
  ROUND(MAX(day_amount), 2) AS max_daily,      -- 历史最高
  ROUND(AVG(day_amount), 2) AS avg_daily,      -- 平均值
  ROUND(percentile_approx(day_amount, 0.95), 2) AS p95_daily  -- 95分位
FROM day_sum
```

### 方案二：动态基线监控（关注异常波动）

**适用场景**：费用存在稳定的上升或下降趋势，需要关注费用波动而非绝对值。

**监控SQL**：

```SQL
-- 昨日费用与历史中位数对比
WITH daily_costs AS (
  SELECT
    to_date(substr(measurement_start, 1, 10)) AS date,
    SUM(COALESCE(total_after_discount, amount * discount_rate)) AS cost
  FROM sys.information_schema.instance_usage
  GROUP BY 1
),
historical_median AS (
  SELECT percentile_approx(cost, 0.5) AS median_cost
  FROM daily_costs
  WHERE date BETWEEN date_sub(current_date(), 31) AND current_date() - INTERVAL 2 DAY
),
yesterday_cost AS (
  SELECT COALESCE(cost, 0) AS cost
  FROM daily_costs
  WHERE date = current_date() - INTERVAL 1 DAY
)
SELECT
  CASE
    WHEN h.median_cost IS NULL OR h.median_cost = 0 THEN 9999.0
    ELSE ROUND(y.cost / h.median_cost, 2)
  END AS cost_ratio
FROM yesterday_cost y
CROSS JOIN historical_median h
```

**告警配置**：
* 预期结果 ≤ 1.5（即昨日费用不超过历史中位数的1.5倍）
* 可根据业务特点调整倍数：
  * 1.5倍：敏感监控
  * 2.0倍：常规监控
  * 3.0倍：宽松监控

**基线阈值辅助分析SQL**：

如果不确定预期结果的合理值，可执行以下 SQL，取过去 30 天的 tp90、tp95 和 tp99 值作为参考：

```SQL
-- 分析历史费用波动，帮助确定合理的告警倍数
WITH daily_costs AS (
  SELECT
    to_date(substr(measurement_start, 1, 10)) AS date,
    SUM(COALESCE(total_after_discount, amount * discount_rate)) AS daily_cost
  FROM sys.information_schema.instance_usage
  WHERE to_date(substr(measurement_start, 1, 10)) >= date_sub(current_date(), 60)
    AND to_date(substr(measurement_start, 1, 10)) < current_date()
  GROUP BY 1
),
-- 计算过去30天的整体中位数作为基线
baseline AS (
  SELECT percentile_approx(daily_cost, 0.5) AS median_cost
  FROM daily_costs
  WHERE date >= date_sub(current_date(), 31)
    AND date < current_date()
),
-- 计算每日费用与基线的比值
ratio_analysis AS (
  SELECT
    d.date,
    d.daily_cost,
    b.median_cost,
    CASE 
      WHEN b.median_cost > 0 THEN ROUND(d.daily_cost / b.median_cost, 2)
      ELSE NULL
    END AS cost_ratio
  FROM daily_costs d
  CROSS JOIN baseline b
  WHERE d.date >= date_sub(current_date(), 30)
)
SELECT
  '历史费用波动分析' AS analysis_type,
  COUNT(*) AS total_days,
  ROUND(MIN(cost_ratio), 2) AS min_ratio,
  ROUND(percentile_approx(cost_ratio, 0.25), 2) AS p25_ratio,
  ROUND(percentile_approx(cost_ratio, 0.5), 2) AS p50_ratio,
  ROUND(percentile_approx(cost_ratio, 0.75), 2) AS p75_ratio,
  ROUND(percentile_approx(cost_ratio, 0.90), 2) AS p90_ratio,
  ROUND(percentile_approx(cost_ratio, 0.95), 2) AS p95_ratio,
  ROUND(percentile_approx(cost_ratio, 0.99), 2) AS p99_ratio,
  ROUND(MAX(cost_ratio), 2) AS max_ratio
FROM ratio_analysis

UNION ALL

-- 基于历史波动计算建议阈值
SELECT
  '建议告警阈值' AS analysis_type,
  NULL AS total_days,
  NULL AS min_ratio,
  NULL AS p25_ratio,
  NULL AS p50_ratio,
  NULL AS p75_ratio,
  ROUND(
    (SELECT percentile_approx(cost_ratio, 0.90) * 1.2 FROM ratio_analysis), 
    2
  ) AS p90_ratio,  -- 敏感监控
  ROUND(
    (SELECT percentile_approx(cost_ratio, 0.95) * 1.1 FROM ratio_analysis), 
    2
  ) AS p95_ratio,  -- 常规监控
  ROUND(
    (SELECT percentile_approx(cost_ratio, 0.99) * 1.05 FROM ratio_analysis), 
    2
  ) AS p99_ratio,  -- 宽松监控
  NULL AS max_ratio;
```

## 监控效果验证

1. **手动测试**：配置质量规则后，可进行试跑，以验证质量规则配置和 SQL 的正确性。
2. **告警测试**：在试跑测试时，可（手动）触发告警以验证通知功能，从而确认通知策略配置正确。
3. **历史回溯**：查看过去 7 天的费用数据，确认阈值的合理性。

通过以上步骤，您可以快速搭建费用异常告警系统，有效控制成本风险。

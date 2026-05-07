# 使用information\_schema作业历史视图分析实践

## 概述

本指南帮助您使用`sys.information_schema.job_history`表分析ClickZetta系统的使用情况，了解资源消耗模式、性能瓶颈和优化机会。所有分析都基于SQL查询，无需额外工具。

## 数据源介绍

### 主要分析表

* **表名**: `sys.information_schema.job_history`
* **用途**: 记录系统中所有作业的执行历史
* **权限**: 需要对`sys.information_schema`的查询权限

### 关键字段说明

| 字段名              | 数据类型      | 说明            |
| ---------------- | --------- | ------------- |
| workspace\_name  | String    | 工作空间名称        |
| virtual\_cluster | String    | 虚拟集群名称        |
| job\_id          | String    | 作业唯一标识        |
| execution\_time  | Float     | 作业执行时间(秒)     |
| start\_time      | Timestamp | 作业开始时间        |
| input\_tables    | String    | 输入表信息(JSON格式) |
| input\_bytes     | String    | 读取的字节数        |
| cache\_hit       | String    | 缓存命中的字节数      |
| status           | String    | 作业执行状态        |

## 分析目标与方法

### 分析目标

1. **资源使用分析**: 识别最繁忙的workspace和virtual cluster
2. **数据访问分析**: 找出访问最频繁的表和数据读取模式
3. **性能优化分析**: 评估缓存命中率和查询效率
4. **容量规划分析**: 为资源扩容提供数据支撑

### 分析时间范围建议

* **日常监控**: 近7天数据
* **周期性分析**: 近30天数据
* **长期趋势**: 近90天数据

## 一、Workspace和Virtual Cluster忙闲程度分析

### 分析目的

识别系统中最繁忙的工作空间和虚拟集群，为资源分配和容量规划提供依据。

### 1.1 Workspace忙闲程度分析

**查询目标**: 按总执行时间排序，找出最忙碌的workspace

```sql
-- Workspace忙闲程度统计(近30天)
SELECT 
    workspace_name,
    COUNT(*) as job_count,                    -- 作业数量
    SUM(execution_time) as total_execution_time,  -- 总执行时间
    AVG(execution_time) as avg_execution_time,    -- 平均执行时间
    SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) as success_jobs,  -- 成功作业数
    SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_jobs,    -- 失败作业数
    ROUND(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate -- 成功率
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
GROUP BY workspace_name
ORDER BY total_execution_time DESC;
```

### 1.2 Virtual Cluster忙闲程度分析

**查询目标**: 分析各虚拟集群的工作负载分布

```sql
-- Virtual Cluster忙闲程度统计(近30天)
SELECT 
    virtual_cluster,
    COUNT(*) as job_count,
    SUM(execution_time) as total_execution_time,
    AVG(execution_time) as avg_execution_time,
    MIN(execution_time) as min_execution_time,
    MAX(execution_time) as max_execution_time
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
  AND virtual_cluster IS NOT NULL
GROUP BY virtual_cluster
ORDER BY total_execution_time DESC;
```

**结果示例**：

| Virtual Cluster名称  | 作业数量    | 总执行时间(秒)   | 平均执行时间(秒) | 最小执行时间(秒) | 最大执行时间(秒) |
| ------------------ | ------- | ---------- | --------- | --------- | --------- |
| MET\*\*\*\_ETL\_GP | 36,695  | 996,551.89 | 27.16     | 0.005     | 745.531   |
| DEFAULT            | 338,797 | 558,213.83 | 1.65      | 0.006     | 3,825.289 |
| CUS\*\*\*\_BILLING | 531,014 | 45,493.62  | 0.09      | 0.003     | 165.597   |
| BI\_ANALYSE        | 49,128  | 1,725.92   | 0.04      | 0.003     | 104.061   |
| VC\_\*\*\*\_CAL    | 80      | 373.29     | 4.67      | 0.007     | 60.184    |
| MY\_FIRST\_VC      | 14      | 0.65       | 0.05      | 0.011     | 0.097     |
| MY\_SECOND\_VC     | 4       | 0.12       | 0.03      | 0.015     | 0.072     |

### 1.3 按时间段分析工作负载

**查询目标**: 了解不同时间段的系统负载情况

```sql
-- 按小时统计作业分布
SELECT 
    HOUR(start_time) as hour_of_day,
    COUNT(*) as job_count,
    SUM(execution_time) as total_execution_time,
    AVG(execution_time) as avg_execution_time
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 7 DAY
GROUP BY HOUR(start_time)
ORDER BY hour_of_day;
```

**结果示例**：

| 小时 | 作业数量   | 总执行时间(秒)  | 平均执行时间(秒) |
| -- | ------ | --------- | --------- |
| 0  | 24,189 | 18,479.99 | 0.76      |
| 1  | 23,823 | 11,243.61 | 0.47      |
| 2  | 17,721 | 12,227.46 | 0.69      |
| 3  | 19,746 | 28,425.32 | 1.44      |
| 4  | 24,535 | 12,300.86 | 0.50      |
| 8  | 28,224 | 18,066.54 | 0.64      |
| 9  | 20,443 | 27,761.99 | 1.36      |
| 15 | 25,004 | 29,525.28 | 1.18      |
| 18 | 20,343 | 29,472.92 | 1.45      |
| 23 | 17,461 | 11,217.91 | 0.64      |

```sql
-- 按工作日统计作业分布
SELECT 
    DAYOFWEEK(start_time) as day_of_week,
    CASE DAYOFWEEK(start_time)
        WHEN 1 THEN '周日'
        WHEN 2 THEN '周一'
        WHEN 3 THEN '周二'
        WHEN 4 THEN '周三'
        WHEN 5 THEN '周四'
        WHEN 6 THEN '周五'
        WHEN 7 THEN '周六'
    END as day_name,
    COUNT(*) as job_count,
    SUM(execution_time) as total_execution_time
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
GROUP BY DAYOFWEEK(start_time)
ORDER BY day_of_week;
```

**结果示例**：

| 星期数 | 星期名称 | 作业数量    | 总执行时间(秒)   |
| --- | ---- | ------- | ---------- |
| 1   | 周日   | 86,383  | 162,597.21 |
| 2   | 周一   | 103,041 | 172,924.33 |
| 3   | 周二   | 158,431 | 276,514.79 |
| 4   | 周三   | 208,982 | 322,615.64 |
| 5   | 周四   | 174,951 | 278,444.13 |
| 6   | 周五   | 143,648 | 238,794.32 |
| 7   | 周六   | 80,380  | 150,478.52 |

## 二、表使用统计分析

### 分析目的

识别最常访问的表，分析数据读取模式，为表优化和索引策略提供指导。

### 2.1 最常访问的表统计

**查询目标**: 找出访问频率最高的表

```sql
-- 解析input_tables JSON并统计表访问情况
SELECT 
    GET_JSON_OBJECT(input_tables, '$.table[0].tableName') as table_name,
    CONCAT(
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[0]'), 
        '.', 
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[1]')
    ) as schema_name,
    COUNT(*) as access_count,
    SUM(CAST(input_bytes AS BIGINT)) as total_bytes_read,
    AVG(CAST(input_bytes AS BIGINT)) as avg_bytes_per_access,
    SUM(CAST(GET_JSON_OBJECT(input_tables, '$.table[0].record') AS BIGINT)) as total_records_read
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
  AND input_tables IS NOT NULL 
  AND input_tables != ''
  AND input_tables != '{"table":[]}'
  AND input_bytes > 0
GROUP BY 
    GET_JSON_OBJECT(input_tables, '$.table[0].tableName'),
    CONCAT(
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[0]'), 
        '.', 
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[1]')
    )
HAVING table_name IS NOT NULL
ORDER BY access_count DESC
LIMIT 20;
```

**结果示例**：

| 表名                                     | Schema名称                   | 访问次数    | 总读取字节数             | 平均每次读取字节数     | 总读取记录数          |
| -------------------------------------- | -------------------------- | ------- | ------------------ | ------------- | --------------- |
| bil\*\*\*\_summary\_mv                 | met\_bill.bil\_mv          | 662,714 | 7,815,536,374,231  | 11,793,230    | 521,718,965,089 |
| vc\_\*\*\*\_calculate                  | met\*\*\*\_bill.public     | 65,837  | 164,257,938,061    | 2,494,918     | 6,127,770,647   |
| met\*\*\*\_events\_all                 | met\*\*\*\_bill.raw        | 8,787   | 11,177,614,832,714 | 1,272,063,000 | 527,117,351,038 |
| cli\*\***gateway**\*\*\_log\_begin     | sto\*\*\*\_metering.public | 8,779   | 110,104,760,842    | 12,541,830    | 198,025,739     |
| sku\_category                          | met\*\*\*\_bill.sku\_meta  | 3,853   | 1,734,507,214,974  | 450,170,600   | 1,029,852       |
| bil\*\*\*\_compute\_detail\_mv         | met\_bill.bil\_mv          | 2,928   | 97,644,902,296     | 33,348,670    | 6,685,089,232   |
| vc\_bil\*\*\*\_without\_zd\_detail\_mv | met\_bill.bil\_mv          | 1,473   | 227,399,306,618    | 154,378,300   | 8,328,596,693   |
| met\*\*\*\_details\_all                | met\*\*\*\_bill.raw        | 1,405   | 4,312,047,296,007  | 3,069,073,000 | 339,604,011,874 |
| mv\_vc\_met\*\*\*\_details             | met\*\*\*\_bill.public     | 1,185   | 8,165,515,464      | 6,890,730     | 856,688,041     |
| sto\_***oss\_bil***\_detail\_mv        | met\_bill.bil\_mv          | 748     | 4,350,578,551      | 5,816,281     | 945,398,941     |

### 2.2 数据读取量TOP表

**查询目标**: 找出读取数据量最大的表

```sql
-- 按数据读取量排序的表统计
SELECT 
    GET_JSON_OBJECT(input_tables, '$.table[0].tableName') as table_name,
    CONCAT(
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[0]'), 
        '.', 
        GET_JSON_OBJECT(input_tables, '$.table[0].namespace[1]')
    ) as schema_name,
    COUNT(*) as access_count,
    SUM(CAST(input_bytes AS BIGINT)) as total_bytes_read,
    SUM(CAST(input_bytes AS BIGINT)) / 1024 / 1024 / 1024 as total_gb_read,
    AVG(CAST(input_bytes AS BIGINT)) / 1024 / 1024 as avg_mb_per_access
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
  AND input_tables IS NOT NULL 
  AND input_tables != ''
  AND input_tables != '{"table":[]}'
  AND input_bytes > 0
GROUP BY 1, 2
HAVING table_name IS NOT NULL
ORDER BY total_bytes_read DESC
LIMIT 20;
```

**结果示例**：

| 表名                                     | Schema名称                         | 访问次数    | 总读取字节数             | 总读取量(GB)  | 平均每次读取(MB) |
| -------------------------------------- | -------------------------------- | ------- | ------------------ | --------- | ---------- |
| met\*\*\*\_events\_all                 | met\*\*\*\_bill.raw              | 8,787   | 11,177,614,832,714 | 10,409.97 | 1,213.13   |
| bil\*\*\*\_summary\_mv                 | met\_bill.bil\_mv                | 662,714 | 7,815,536,374,231  | 7,278.79  | 11.25      |
| met\*\*\*\_details\_all                | met\*\*\*\_bill.raw              | 1,405   | 4,312,047,296,007  | 4,015.91  | 2,926.90   |
| sku\_category                          | met\*\*\*\_bill.sku\_meta        | 3,853   | 1,734,507,214,974  | 1,615.39  | 429.32     |
| dwd\_cz\_jobs                          | sys\_meta\_warehouse.inf\_schema | 35      | 387,223,640,942    | 360.63    | 10,551.01  |
| vc\_met\*\*\*\_details                 | met\*\*\*\_bill.public           | 743     | 371,186,266,727    | 345.69    | 476.43     |
| vc\_bil\*\*\*\_without\_zd\_detail\_mv | met\_bill.bil\_mv                | 1,473   | 227,399,306,618    | 211.78    | 147.23     |
| vc\_\*\*\*\_calculate                  | met\*\*\*\_bill.public           | 65,837  | 164,257,938,061    | 152.98    | 2.38       |
| dim\_stu\*\*\*\_instance\_dmin\_f      | met\_bill.stu\_dw\_tenant        | 405     | 130,022,636,178    | 121.09    | 306.17     |
| ins\*\*\*\_account\_mapping            | met\*\*\*\_bill.public           | 730     | 118,682,911,967    | 110.53    | 155.05     |

### 2.3 表访问时间分布分析

**查询目标**: 分析表访问的时间模式

```sql
-- 分析主要表的访问时间分布
WITH top_tables AS (
    SELECT GET_JSON_OBJECT(input_tables, '$.table[0].tableName') as table_name
    FROM sys.information_schema.job_history 
    WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
      AND input_tables IS NOT NULL 
      AND input_tables != '{"table":[]}'
    GROUP BY 1
    ORDER BY COUNT(*) DESC
    LIMIT 5
)
SELECT 
    GET_JSON_OBJECT(h.input_tables, '$.table[0].tableName') as table_name,
    HOUR(h.start_time) as hour_of_day,
    COUNT(*) as access_count,
    SUM(CAST(h.input_bytes AS BIGINT)) / 1024 / 1024 as total_mb_read
FROM sys.information_schema.job_history h
JOIN top_tables t ON GET_JSON_OBJECT(h.input_tables, '$.table[0].tableName') = t.table_name
WHERE h.start_time >= CURRENT_DATE() - INTERVAL 7 DAY
GROUP BY 1, 2
ORDER BY table_name, hour_of_day;
```

**结果示例**：

| 表名                     | 小时 | 访问次数   | 总读取量(MB)   |
| ---------------------- | -- | ------ | ---------- |
| bil\*\*\*\_summary\_mv | 0  | 21,826 | 238,651.21 |
| bil\*\*\*\_summary\_mv | 1  | 22,557 | 251,626.92 |
| bil\*\*\*\_summary\_mv | 2  | 15,100 | 173,747.51 |
| bil\*\*\*\_summary\_mv | 3  | 18,436 | 216,057.70 |
| bil\*\*\*\_summary\_mv | 4  | 22,117 | 249,271.86 |
| bil\*\*\*\_summary\_mv | 8  | 24,900 | 286,801.29 |
| bil\*\*\*\_summary\_mv | 9  | 17,682 | 207,026.35 |
| bil\*\*\*\_summary\_mv | 15 | 19,234 | 225,847.45 |
| bil\*\*\*\_summary\_mv | 18 | 16,891 | 198,234.12 |
| bil\*\*\*\_summary\_mv | 23 | 14,567 | 167,432.89 |

## 三、Cache命中率分析

### 分析目的

评估系统缓存效率，识别缓存优化机会，提升查询性能。

### 3.1 总体缓存命中率

**查询目标**: 计算系统整体的缓存命中率

```sql
-- 系统总体缓存命中率统计
SELECT 
    CASE 
        WHEN cache_hit = '0' OR cache_hit IS NULL THEN 'Cache Miss'
        ELSE 'Cache Hit'
    END as cache_status,
    COUNT(*) as job_count,
    ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage,
    SUM(execution_time) as total_execution_time,
    AVG(execution_time) as avg_execution_time
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
GROUP BY 1
ORDER BY job_count DESC;
```

**结果示例**：

| 缓存状态       | 作业数量    | 百分比(%) | 总执行时间(秒)   | 平均执行时间(秒) |
| ---------- | ------- | ------ | ---------- | --------- |
| Cache Hit  | 738,784 | 77.29  | 883,488.52 | 1.20      |
| Cache Miss | 217,032 | 22.71  | 718,880.42 | 3.31      |

### 3.2 各Workspace缓存命中率

**查询目标**: 比较不同workspace的缓存使用效果

```sql
-- 各Workspace的缓存命中率分析
SELECT 
    workspace_name,
    SUM(CASE WHEN cache_hit != '0' AND cache_hit IS NOT NULL THEN 1 ELSE 0 END) as cache_hit_jobs,
    SUM(CASE WHEN cache_hit = '0' OR cache_hit IS NULL THEN 1 ELSE 0 END) as cache_miss_jobs,
    COUNT(*) as total_jobs,
    ROUND(SUM(CASE WHEN cache_hit != '0' AND cache_hit IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as cache_hit_rate,
    SUM(CAST(cache_hit AS BIGINT)) / 1024 / 1024 / 1024 as total_cache_gb
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
GROUP BY workspace_name
ORDER BY cache_hit_rate DESC;
```

**结果示例**：

| Workspace名称             | 缓存命中作业数 | 缓存未命中作业数 | 总作业数    | 缓存命中率(%) | 总缓存量(GB)  |
| ----------------------- | ------- | -------- | ------- | -------- | --------- |
| met\*\*\*\_n\_bill      | 732,157 | 136,263  | 868,420 | 84.31    | 12,336.17 |
| sto\*\*\*\_metering     | 6,290   | 29,082   | 35,372  | 17.78    | 36.20     |
| cos\*\*\*\_analyse      | 337     | 51,664   | 52,001  | 0.65     | 98.62     |
| qui\*\*\*\_ws           | 0       | 18       | 18      | 0.00     | 0.00      |
| cli\*\*\*\_sample\_data | 0       | 1        | 1       | 0.00     | 0.00      |
| dev\_envirment          | 0       | 4        | 4       | 0.00     | 0.00      |

### 3.3 缓存命中率趋势分析

**查询目标**: 观察缓存命中率的时间趋势

```sql
-- 按天统计缓存命中率趋势
SELECT 
    DATE(start_time) as date,
    SUM(CASE WHEN cache_hit != '0' AND cache_hit IS NOT NULL THEN 1 ELSE 0 END) as cache_hit_jobs,
    COUNT(*) as total_jobs,
    ROUND(SUM(CASE WHEN cache_hit != '0' AND cache_hit IS NOT NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as cache_hit_rate
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
GROUP BY DATE(start_time)
ORDER BY date;
```

**结果示例**：

| 日期         | 缓存命中作业数 | 总作业数   | 缓存命中率(%) |
| ---------- | ------- | ------ | -------- |
| 2025-04-23 | 20,145  | 26,834 | 75.08    |
| 2025-04-24 | 22,567  | 28,901 | 78.09    |
| 2025-04-25 | 24,123  | 31,245 | 77.21    |
| 2025-04-26 | 25,890  | 33,127 | 78.15    |
| 2025-04-27 | 23,456  | 30,234 | 77.57    |
| 2025-04-28 | 21,789  | 28,567 | 76.27    |
| 2025-04-29 | 26,234  | 34,123 | 76.88    |
| 2025-04-30 | 24,567  | 31,890 | 77.04    |
| 2025-05-01 | 22,890  | 29,567 | 77.42    |
| 2025-05-02 | 25,123  | 32,456 | 77.40    |

## 四、性能问题诊断查询

### 4.1 长时间运行的作业

**查询目标**: 识别执行时间异常长的作业

```sql
-- 查找长时间运行的作业
SELECT 
    job_id,
    workspace_name,
    virtual_cluster,
    job_type,
    execution_time,
    start_time,
    end_time,
    status,
    LEFT(job_text, 100) as job_text_preview
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 7 DAY
  AND execution_time > 300  -- 大于5分钟的作业
ORDER BY execution_time DESC
LIMIT 50;
```

**结果示例**：

| 作业ID              | Workspace名称         | Virtual Cluster    | 作业类型   | 执行时间(秒)  | 开始时间                | 状态      | 作业预览                                                                                            |
| ----------------- | ------------------- | ------------------ | ------ | -------- | ------------------- | ------- | ----------------------------------------------------------------------------------------------- |
| 202505\*\*\*96423 | met\*\*\*\_n\_bill  | MET\*\*\*\_ETL\_GP | SELECT | 3,825.29 | 2025-05-22 03:15:23 | SUCCESS | SELECT SUM(CAST(record\_count AS BIGINT)) as total\_records, SUM(CAST(data\_size AS BIGINT))... |
| 202505\*\*\*84521 | met\*\*\*\_n\_bill  | MET\*\*\*\_ETL\_GP | SELECT | 2,456.78 | 2025-05-21 15:42:11 | SUCCESS | WITH billing\_data AS (SELECT workspace\_id, SUM(compute\_time) FROM billing\_summary...        |
| 202505\*\*\*73941 | met\*\*\*\_n\_bill  | DEFAULT            | INSERT | 1,923.45 | 2025-05-20 09:33:47 | SUCCESS | INSERT INTO meter SELECT event\_id, workspace\_id, timestamp, event\_type...                    |
| 202505\*\*\*62847 | sto\*\*\*\_metering | DEFAULT            | SELECT | 1,567.23 | 2025-05-19 14:28:36 | FAILED  | SELECT storage\_type, bucket\_name, SUM(storage\_size) FROM sto\*\*\*\_usage WHERE date...      |
| 202505\*\*\*51238 | met\*\*\*\_n\_bill  | BI\_ANALYSE        | SELECT | 1,234.56 | 2025-05-18 11:17:29 | SUCCESS | SELECT DATE\_TRUNC('hour', start\_time) as hour, COUNT(\*) as job\_count FROM job\_his...       |

### 4.2 失败作业分析

**查询目标**: 分析作业失败的模式和原因

```sql
-- 失败作业统计和分析
SELECT 
    workspace_name,
    virtual_cluster,
    job_type,
    COUNT(*) as failed_count,
    COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() as failure_percentage,
    LEFT(error_message, 100) as common_error
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 7 DAY
  AND status = 'FAILED'
GROUP BY workspace_name, virtual_cluster, job_type, LEFT(error_message, 100)
ORDER BY failed_count DESC
LIMIT 20;
```

**结果示例**：

| Workspace名称         | Virtual Cluster    | 作业类型   | 失败次数  | 失败占比(%) | 常见错误信息                                                              |
| ------------------- | ------------------ | ------ | ----- | ------- | ------------------------------------------------------------------- |
| cos\*\*\*\_analyse  | BI\_ANALYSE        | SELECT | 1,245 | 45.67   | CZLH-40000 Table 'cost\_data.billing\_temp' doesn't exist           |
| met\*\*\*\_n\_bill  | DEFAULT            | INSERT | 567   | 20.82   | CZLH-42000 Duplicate key error: PRIMARY KEY constraint violated     |
| sto\*\*\*\_metering | DEFAULT            | SELECT | 234   | 8.59    | CZLH-42000 Semantic analysis exception - cannot resolve column      |
| met\*\*\*\_n\_bill  | MET\*\*\*\_ETL\_GP | UPDATE | 156   | 5.73    | CZLH-41000 Lock timeout: Table locked by another transaction        |
| cos\*\*\*\_analyse  | BI\_ANALYSE        | DELETE | 89    | 3.27    | CZLH-43000 Syntax error: Invalid column reference 'unknown\_column' |

### 4.3 资源消耗TOP作业

**查询目标**: 找出资源消耗最大的作业类型

```sql
-- 高资源消耗作业分析
SELECT 
    job_type,
    workspace_name,
    COUNT(*) as job_count,
    SUM(execution_time) as total_execution_time,
    AVG(execution_time) as avg_execution_time,
    SUM(CAST(input_bytes AS BIGINT)) / 1024 / 1024 / 1024 as total_input_gb,
    AVG(CAST(input_bytes AS BIGINT)) / 1024 / 1024 as avg_input_mb
FROM sys.information_schema.job_history 
WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
  AND input_bytes > 0
GROUP BY job_type, workspace_name
ORDER BY total_execution_time DESC
LIMIT 20;
```

**结果示例**：

| 作业类型   | Workspace名称         | 作业数量    | 总执行时间(秒)     | 平均执行时间(秒) | 总输入量(GB)  | 平均输入量(MB) |
| ------ | ------------------- | ------- | ------------ | --------- | --------- | --------- |
| SELECT | met\*\*\*\_n\_bill  | 345,678 | 1,234,567.89 | 3.57      | 15,234.56 | 45.67     |
| INSERT | met\*\*\*\_n\_bill  | 67,890  | 456,789.12   | 6.73      | 8,901.23  | 135.45    |
| UPDATE | met\*\*\*\_n\_bill  | 12,345  | 234,567.89   | 19.01     | 3,456.78  | 289.34    |
| DELETE | cos\*\*\*\_analyse  | 8,901   | 123,456.78   | 13.87     | 1,234.56  | 142.78    |
| CREATE | sto\*\*\*\_metering | 2,345   | 56,789.12    | 24.21     | 567.89    | 249.12    |

## 五、实用分析模板

### 5.1 每日监控报告

```sql
-- 每日系统运行状况报告
SELECT 
    '总体概览' as metric_category,
    'Jobs Total' as metric_name,
    CAST(COUNT(*) AS STRING) as metric_value
FROM sys.information_schema.job_history 
WHERE DATE(start_time) = CURRENT_DATE() - INTERVAL 1 DAY

UNION ALL

SELECT 
    '总体概览',
    'Execution Time (Hours)',
    CAST(ROUND(SUM(execution_time) / 3600, 2) AS STRING)
FROM sys.information_schema.job_history 
WHERE DATE(start_time) = CURRENT_DATE() - INTERVAL 1 DAY

UNION ALL

SELECT 
    '总体概览',
    'Success Rate (%)',
    CAST(ROUND(SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) AS STRING)
FROM sys.information_schema.job_history 
WHERE DATE(start_time) = CURRENT_DATE() - INTERVAL 1 DAY

ORDER BY metric_category, metric_name;
```

**结果示例**：

| 指标类别 | 指标名称                   | 指标值    |
| ---- | ---------------------- | ------ |
| 总体概览 | Execution Time (Hours) | 427.35 |
| 总体概览 | Jobs Total             | 34,567 |
| 总体概览 | Success Rate (%)       | 97.85  |

### 5.2 资源使用评估

```sql
-- 资源使用评估查询
WITH resource_summary AS (
    SELECT 
        workspace_name,
        COUNT(*) as jobs,
        SUM(execution_time) as total_time,
        SUM(CAST(input_bytes AS BIGINT)) as total_bytes
    FROM sys.information_schema.job_history 
    WHERE start_time >= CURRENT_DATE() - INTERVAL 30 DAY
    GROUP BY workspace_name
)
SELECT 
    workspace_name,
    jobs,
    ROUND(total_time / 3600, 2) as total_hours,
    ROUND(total_bytes / 1024 / 1024 / 1024, 2) as total_gb,
    ROUND(jobs * 100.0 / SUM(jobs) OVER(), 2) as job_percentage,
    ROUND(total_time * 100.0 / SUM(total_time) OVER(), 2) as time_percentage
FROM resource_summary
ORDER BY total_time DESC;
```

**结果示例**：

| Workspace名称             | 作业数量    | 总小时数   | 总数据量(GB)  | 作业占比(%) | 时间占比(%) |
| ----------------------- | ------- | ------ | --------- | ------- | ------- |
| met\*\*\*\_n\_bill      | 868,420 | 430.54 | 24,567.89 | 90.85   | 96.74   |
| sto\*\*\*\_metering     | 35,372  | 13.01  | 1,234.56  | 3.70    | 2.93    |
| cos\*\*\*\_analyse      | 52,001  | 1.55   | 567.23    | 5.44    | 0.35    |
| qui\*\*\*\_ws           | 18      | 0.00   | 0.01      | 0.00    | 0.00    |
| dev\_envirment          | 4       | 0.00   | 0.02      | 0.00    | 0.00    |
| cli\*\*\*\_sample\_data | 1       | 0.00   | 0.00      | 0.00    | 0.00    |

### 分析频率建议

* **每日监控**: 执行总体概览和失败作业分析
* **每周分析**: 运行完整的忙闲程度和表使用分析
* **每月评估**: 进行缓存效率和资源规划分析

建议将常用查询保存为视图，便于重复使用。

### 优化行动指南

* **高执行时间作业**: 检查SQL优化机会，尝试用Dynamic Table的增量计算链路降低计算量，减少执行时间；
* **低缓存命中率**: 调整分析型计算集群的自动关机时间，在查询高峰期尽量不关机，避免丢失缓存；
* **高频访问表**: 考虑分区、索引优化；
* **资源不均衡**: 重新分配workspace内的计算集群资源规格，对频繁使用的计算集群，如果希望降低作业执行时间，可以适当扩容。

^

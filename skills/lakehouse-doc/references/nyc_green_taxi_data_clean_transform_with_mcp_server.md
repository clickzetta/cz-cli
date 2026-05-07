# NYC绿色出租车数据清洗与转化案例

使用Claude Desktop与云器Lakehouse MCP Server实现智能数据处理，通过全链路自然语言对话方式完成数据清洗与转化。

```
我有哪些和NYC绿色出租车相关的表？
nyc_green_taxi_2025里有多少行数据？都是哪些月的？
分析一下这些数据需要做哪些清洗转化提高分析效果？
请按顺序都执行
```

## 案例概述

本文档展示了如何使用Claude Desktop配合云器Lakehouse MCP Server，对NYC绿色出租车真实数据进行端到端的智能分析处理。通过自然语言对话，我们将351,612条原始数据清洗转化为高质量的分析数据集，并新增了21个业务洞察字段，为深度分析奠定基础。

## 技术方案架构

### 核心技术栈

**Claude Desktop**

* Anthropic 开发的 AI 助手桌面应用
* 支持全自然语言交互，无需编写 SQL 或掌握具体命令
* 通过 MCP (Model Context Protocol) 协议连接外部数据系统

**云器 Lakehouse MCP Server**

* 云器科技开发的 Lakehouse 数据湖仓一体化平台的 MCP Server
* 通过 MCP 协议提供 40+ 专业数据工具函数

**MCP (Model Context Protocol)**

* Claude 与外部系统的标准化连接协议
* 实现 AI 助手与数据平台的无缝集成
* 支持实时数据操作和智能化分析

### 数据处理流程

```
原始数据 → 质量清洗 → 时间维度增强 → 业务指标计算 → 分类标准化 → 性能优化 → 分析就绪
```

## 数据源介绍

### NYC绿色出租车数据集

* **数据规模**：351,612条出租车行程记录
* **时间跨度**：2025年1-7月完整数据
* **数据字段**：22个原始字段，包含时间、位置、费用、支付等信息
* **数据来源**：NYC TLC（纽约出租车及豪华车委员会）官方数据

### 原始数据结构

| 字段名                     | 数据类型      | 说明       |
| ----------------------- | --------- | -------- |
| vendorid                | bigint    | 供应商ID    |
| lpep\_pickup\_datetime  | timestamp | 上车时间     |
| lpep\_dropoff\_datetime | timestamp | 下车时间     |
| pulocationid            | bigint    | 上车地点ID   |
| dolocationid            | bigint    | 下车地点ID   |
| passenger\_count        | bigint    | 乘客数量     |
| trip\_distance          | double    | 行程距离（英里） |
| fare\_amount            | double    | 基础费用     |
| total\_amount           | double    | 总费用      |
| payment\_type           | bigint    | 支付方式     |

## 智能数据处理实战

### 第一步：数据质量诊断

用户只需自然语言提问："*这些数据需要做哪些清洗转化提高分析效果*？"

Claude Desktop通过云器Lakehouse MCP Server自动执行数据质量分析：

**发现的主要问题**：

* 空值问题：23,304 条记录（6.6%）的乘客数量为空
* 异常值：16,850 条记录（4.8%）的行程距离 ≤ 0
* 时间异常：1,713 条记录的下车时间早于上车时间
* 费用计算错误：40,942 条记录（11.6%）费用计算不一致

### 第二步：智能数据清洗

用户请求："*请按顺序都执行*"

Claude Desktop自动生成并执行清洗方案：

#### 异常数据过滤

```sql
-- 自动生成的清洗逻辑
CREATE TABLE nyc_green_taxi_2025_cleaned AS 
SELECT *,
    -- 修复passenger_count空值
    CASE 
        WHEN passenger_count IS NULL THEN 1
        WHEN passenger_count = 0 THEN 1  
        WHEN passenger_count > 6 THEN 6
        ELSE passenger_count
    END as passenger_count_cleaned,
    
    -- 计算行程时长（分钟）
    TIMESTAMPDIFF(MINUTE, lpep_pickup_datetime, lpep_dropoff_datetime) as trip_duration_minutes
FROM nyc_green_taxi_2025
WHERE 
    lpep_dropoff_datetime > lpep_pickup_datetime
    AND trip_distance > 0 AND trip_distance < 100
    AND fare_amount > 0 AND fare_amount < 500
    AND total_amount > 0 AND total_amount < 1000
```

**清洗效果**：

* 数据保留率：93.93%（330,257 条有效记录）
* 空值消除率：100%
* 异常值清理率：100%

### 第三步：时间维度增强

Claude Desktop智能识别时间分析需求，自动添加时间维度字段：

```sql
-- 自动增加的时间分析字段
ALTER TABLE nyc_green_taxi_2025_cleaned ADD COLUMNS (
    pickup_year INT,
    pickup_month INT,
    pickup_hour INT,
    pickup_dayofweek INT,
    pickup_is_weekend BOOLEAN,
    pickup_time_period STRING,  -- 早高峰/晚高峰/平时/深夜
    pickup_season STRING        -- 春夏秋冬
);
```

**时间模式洞察**：

* 春季出行最多（28.82%）
* 平时时段占比最高（63.83%）
* 早高峰（7-9 点）和晚高峰（17-19 点）特征明显

### 第四步：业务指标计算

系统自动计算关键业务指标：

```sql
-- 智能生成的业务指标
trip_speed_mph,          -- 平均速度（英里/小时）
fare_per_mile,           -- 每英里费用
tip_rate,                -- 小费率
trip_distance_category,  -- 距离分类（短途/中途/长途）
fare_category,           -- 费用分类（低价/中价/高价）
passenger_load_factor    -- 载客率分类
```

**业务洞察发现**：

* 中途行程（1-5 英里）占主导地位（68.4%）。
* 平均行程速度：12.0 英里/小时。
* 信用卡支付占 74.79%，现金支付 24.26%。

### 第五步：分类字段标准化

将编码转换为可读标签：

| 原始编码            | 标准化标签         | 占比     |
| --------------- | ------------- | ------ |
| vendorid=2      | VeriFone Inc  | 85.34% |
| payment\_type=1 | Credit Card   | 74.79% |
| ratecodeid=1    | Standard Rate | 94.28% |

### 第六步：性能优化

创建优化表并建立索引：

* 数据压缩：从 17.2 MB 优化到 9.37 MB
* 创建 BLOOMFILTER 索引提升查询性能
* 支持高效的位置和供应商筛选

## 核心MCP工具函数介绍

### 数据查询工具

* **read_query**: 执行 SELECT 查询，支持结果限制
* **write_query**: 执行 DDL/DML 操作
* **desc_object**: 查看表结构和元数据信息

### 数据管理工具

* **create_table**: 智能表创建，支持分区和聚集
* **create_index**: 创建 BLOOMFILTER/INVERTED/VECTOR 索引
* **show_object_list**: 智能对象列表展示

### 数据分析工具

* **vector_search**: 向量相似性搜索
* **match_all**: 全文检索功能
* **get_current_context**: 获取当前数据库上下文

### 数据导入工具

* **import_data_src**: 从 URL/文件导入数据
* **preview_volume_data**: 数据预览和导入
* **put_file_to_volume**: 文件上传到存储卷

## 最终成果

### 数据质量提升对比

| 指标   | 清洗前     | 清洗后     | 改善效果     |
| ---- | ------- | ------- | -------- |
| 总记录数 | 351,612 | 330,257 | 保留 93.93% |
| 空值记录 | 23,304  | 0       | 100% 消除   |
| 异常距离 | 16,850  | 0       | 100% 清理   |
| 时间异常 | 1,713   | 0       | 100% 修复   |
| 分析字段 | 22 个     | 43 个     | 增加 95%    |

### 新增业务分析能力

**1. 时间模式分析**

```sql
-- 不同时间段的运营效率分析
SELECT pickup_time_period, pickup_season,
       AVG(trip_speed_mph) as avg_speed,
       AVG(tip_rate) as avg_tip_rate
FROM nyc_green_taxi_2025_optimized 
GROUP BY pickup_time_period, pickup_season;
```

**2. 定价策略分析**

```sql
-- 距离-费用关系优化
SELECT trip_distance_category, fare_category,
       COUNT(*) as trip_count,
       AVG(fare_per_mile) as avg_fare_per_mile
FROM nyc_green_taxi_2025_optimized 
GROUP BY trip_distance_category, fare_category;
```

**3. 供应商性能对比**

```sql
-- 服务质量竞争分析
SELECT vendor_name,
       AVG(trip_speed_mph) as avg_speed,
       AVG(tip_rate) as customer_satisfaction
FROM nyc_green_taxi_2025_optimized 
GROUP BY vendor_name;
```

## 方案优势

### 用户体验优势

* **零代码开发**：纯自然语言交互，无需 SQL 技能
* **智能化处理**：AI 自动识别数据问题并生成解决方案
* **实时反馈**：即时查看处理结果和质量报告

### 技术能力优势

* **企业级性能**：基于 Spark 引擎，支持 PB 级数据处理
* **全栈数据工具**：40+ 专业函数覆盖完整数据生命周期
* **开放集成**：标准 MCP 协议，易于扩展和集成

### 业务价值优势

* **数据质量提升**：从 88.4% 准确率提升到 95%+
* **分析维度丰富**：从 22 个字段扩展到 43 个分析维度
* **洞察深度增强**：支持时间模式、定价策略、运营效率等多维分析

## 应用场景扩展

### 行业应用

* **交通运输**：出租车、网约车、物流配送数据分析
* **零售电商**：客户行为、销售趋势、库存优化
* **金融服务**：风险评估、客户画像、交易分析
* **制造业**：生产效率、质量控制、供应链分析

### 数据类型支持

* **结构化数据**：CSV、Parquet、Delta Lake 格式
* **半结构化数据**：JSON、XML、日志文件
* **流式数据**：Kafka 实时数据流处理
* **向量数据**：AI/ML 模型特征向量分析

## 开始使用

### 环境准备

1. 下载安装Claude Desktop应用
2. 获取云器Lakehouse访问权限
3. 配置MCP Server连接参数
4. 准备数据源（本地文件或云存储）

### 快速上手

1. 在Claude Desktop中连接云器Lakehouse
2. 使用自然语言描述分析需求
3. 让AI自动生成和执行数据处理方案
4. 实时查看结果并迭代优化

### 最佳实践

* 先进行小规模数据测试
* 关注数据质量报告和清洗建议
* 利用时间和业务维度增强分析深度
* 建立索引优化查询性能

## 总结

本案例展示了 Claude Desktop 与云器 Lakehouse MCP Server 的强大组合，通过 AI 驱动的智能数据处理，将复杂的数据工程任务简化为自然语言对话。从数据质量诊断到业务洞察生成，整个过程实现了 **93.93% 的数据保留率** 和 **95% 的字段增强**，为后续的深度分析奠定了坚实基础。

这种“AI + Lakehouse”的创新模式，不仅大幅降低了数据分析的技术门槛，更为企业数字化转型提供了高效、智能的解决方案。无论是数据科学家还是业务分析师，都能通过这套方案快速获得专业级的数据处理能力。

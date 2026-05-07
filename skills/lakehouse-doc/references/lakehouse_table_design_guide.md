# 云器Lakehouse表设计最佳实践指南

## 🧭 内容介绍

### 文档概述

本指南是云器Lakehouse平台上表设计的全面参考手册，涵盖从基础数据类型选择到复杂企业级架构模式的各个方面。

### 如何使用本指南

根据您的角色和需求，我们建议以下阅读路径：

* **数据架构师**: 重点关注设计理念(第1章)、分区架构(第5章)和企业级设计模式(第11章)
* **数据工程师**: 详细了解数据类型设计(第3章)、索引架构(第6章)和性能优化(第9章)
* **后端开发者**: 集中阅读表结构设计(第4章)、复杂数据类型(第3.3节)和故障排查(第10章)
* **快速应用**: 直接参考设计评审检查清单(第9章)作为项目指导框架

### 核心章节导览

1. **设计理念与原则** - 基础设计哲学和决策框架
2. **数据类型设计策略** - 详细的类型选择指南和应用场景
3. **表结构设计模式** - 约束、默认值和生成列的有效应用
4. **分区架构设计** - 分区类型选择和优化策略
5. **分桶与排序优化** - 数据物理组织的最佳实践
6. **索引架构设计** - 向量、倒排、布隆过滤器索引详解
7. **性能优化策略** - 查询性能和存储成本优化技巧
8. **常见设计陷阱与解决方案** - 避免常见错误和优化建议
9. **设计评审检查清单** - 全面的设计验证流程
10. **企业级设计模式实战** - 四种高级应用架构详解
11. **实验环境清理指南** - 资源管理最佳实践
12. **总结** - 内容总结

首次阅读时，建议先通读设计理念部分，了解核心原则，然后根据您当前的具体需求选择相关章节深入研究。每个代码示例都可以直接复制使用，帮助您快速应用到实际工作中。

***

## 🎯 设计理念与原则

### 核心设计思想

在云器Lakehouse中，优秀的表设计应当平衡**性能、可维护性和业务需求**。本指南遵循以下验证过的核心原则：

1. **业务驱动设计** - 表结构应当反映业务模型和查询模式
2. **性能优先考虑** - 合理的分区、分桶和索引策略至关重要
3. **面向未来扩展** - 设计时考虑数据增长和业务演进
4. **运维友好性** - 简化日常维护和问题排查的复杂度

### 设计决策框架

每个设计决策都应当考虑以下维度：

* **查询模式**: 主要的数据访问方式和频率
* **数据特征**: 数据量级、增长速度、分布特点
* **业务需求**: 实时性要求、一致性需求、扩展性需求
* **资源约束**: 存储成本、计算资源、运维复杂度

***

## 📊 数据类型设计策略

### 数值类型选择指南

#### 自增主键设计

**关键限制**: IDENTITY列仅支持BIGINT类型

```sql
-- 正确的IDENTITY使用(唯一支持的语法)
CREATE TABLE business_events (
    event_id BIGINT IDENTITY,              -- 仅支持BIGINT类型
    event_data JSON,
    created_at TIMESTAMP DEFAULT current_timestamp()
);

-- 带种子值的IDENTITY
CREATE TABLE user_accounts (
    user_id BIGINT IDENTITY(1000),         -- 从1000开始自增
    username VARCHAR(50) NOT NULL
);
```

**不支持的IDENTITY语法(测试确认会失败**):

```sql
-- 这些都会导致错误：invalid identity column type int, currently only BIGINT is supported
CREATE TABLE wrong_examples (
    id INT IDENTITY,                       -- 失败
    small_id SMALLINT IDENTITY,            -- 失败  
    str_id VARCHAR(50) IDENTITY            -- 失败
);
```

#### 业务数值字段选择

| 数据类型           | 存储空间 | 数值范围             | 推荐场景     | 实际应用示例                     |
| -------------- | ---- | ---------------- | -------- | -------------------------- |
| `TINYINT`      | 1字节  | -128 到 127       | 状态码、等级   | `status TINYINT DEFAULT 1` |
| `SMALLINT`     | 2字节  | -32,768 到 32,767 | 年份、计数器   | `birth_year SMALLINT`      |
| `INT`          | 4字节  | ±21亿             | 业务ID、大计数 | `user_id INT NOT NULL`     |
| `BIGINT`       | 8字节  | ±922万万亿          | 自增主键、大数值 | `id BIGINT IDENTITY`       |
| `DECIMAL(p,s)` | 变长   | 最高精度38位          | 金融计算     | `amount DECIMAL(15,2)`     |
| `FLOAT`        | 4字节  | 单精度浮点            | 科学计算、坐标  | `temperature FLOAT`        |
| `DOUBLE`       | 8字节  | 双精度浮点            | 高精度计算    | `coordinate DOUBLE`        |

### 字符串类型策略

#### 长度规划原则（基于实际业务需求）

| 业务场景  | 推荐类型            | 长度设置      | 实际覆盖率 | 设计考量              |
| ----- | --------------- | --------- | ----- | ----------------- |
| 邮箱地址  | `VARCHAR(320)`  | RFC5321标准 | 99.9% | 国际标准长度            |
| 用户名   | `VARCHAR(50)`   | 实际调研      | 99.5% | 平衡存储和使用           |
| 手机号   | `VARCHAR(20)`   | 国际格式      | 100%  | 支持+86-138\*\*\*\* |
| URL地址 | `VARCHAR(2048)` | 实际测量      | 98%   | 含复杂查询参数           |
| 文章标题  | `VARCHAR(200)`  | SEO优化     | 95%   | 搜索引擎友好            |
| 商品描述  | `VARCHAR(2000)` | 电商需求      | 90%   | 详情页展示             |
| 长文本内容 | `STRING`        | 不限长度      | 100%  | 博客、评论等            |

```sql
-- 字符串类型最佳实践
CREATE TABLE user_profiles (
    user_id BIGINT IDENTITY,
    
    -- 固定格式使用CHAR
    country_code CHAR(2),                   -- CN, US, JP
    currency_code CHAR(3),                  -- USD, CNY, EUR
    
    -- 业务字段使用合理的VARCHAR长度
    username VARCHAR(50) NOT NULL,
    email VARCHAR(320) NOT NULL,
    mobile_phone VARCHAR(20),
    
    -- 描述性内容
    nickname VARCHAR(100),
    bio VARCHAR(500),                       -- 个人简介
    full_description STRING,                -- 详细描述，长度不定
    
    -- 结构化数据
    preferences JSON DEFAULT '{}'
);
```

### 向量类型应用场景

#### 向量类型语法和应用

**标准语法**: `VECTOR(scalar_type, dimension)` 或 `VECTOR(dimension)`

| 标量类型      | 存储开销  | 适用场景      | 维度推荐     | 应用示例                   |
| --------- | ----- | --------- | -------- | ---------------------- |
| `FLOAT`   | 4字节/维 | 语义向量、通用AI | 128-2048 | `VECTOR(FLOAT, 768)`   |
| `INT`     | 4字节/维 | 离散特征、计数向量 | 64-1024  | `VECTOR(INT, 256)`     |
| `TINYINT` | 1字节/维 | 压缩向量、移动端  | 64-512   | `VECTOR(TINYINT, 128)` |

**实际应用案例**:

```sql
CREATE TABLE ai_content_vectors (
    content_id BIGINT IDENTITY,
    content_type VARCHAR(50),
    
    -- 不同业务场景的向量配置
    text_embedding VECTOR(FLOAT, 768),      -- BERT/RoBERTa输出
    image_features VECTOR(FLOAT, 512),      -- ResNet/CNN特征
    user_preference VECTOR(INT, 256),       -- 推荐系统用户画像
    mobile_compact VECTOR(TINYINT, 128),    -- 移动端轻量化
    general_vector VECTOR(512)              -- 默认FLOAT类型
);

-- 向量数据插入语法（注意：维度必须严格匹配）
INSERT INTO ai_content_vectors (content_type, text_embedding) VALUES (
    'document',
    cast(concat('[', repeat('0.1,', 767), '0.1]') as VECTOR(FLOAT, 768))
);
```

### 复杂数据类型使用指南

#### STRUCT类型正确使用

**正确的STRUCT数据插入语法**:

```sql
CREATE TABLE user_complex_data (
    user_id BIGINT IDENTITY,
    
    -- 简单结构体
    basic_info STRUCT<id:INT, name:STRING, age:INT>,
    
    -- 复杂嵌套结构体  
    detailed_profile STRUCT<
        personal:STRUCT<name:STRING, email:STRING>,
        address:STRUCT<city:STRING, country:STRING>,
        preferences:MAP<STRING, STRING>
    >
);

-- 方法1：使用struct函数（按位置传参）
INSERT INTO user_complex_data (basic_info) VALUES (
    struct(123, 'Alice', 25)
);

-- 方法2：使用named_struct函数（推荐，明确字段名）
INSERT INTO user_complex_data (basic_info) VALUES (
    named_struct('id', 123, 'name', 'Alice', 'age', 25)
);

-- 复杂嵌套结构的插入
INSERT INTO user_complex_data (detailed_profile) VALUES (
    named_struct(
        'personal', named_struct('name', 'Bob', 'email', 'bob@test.com'),
        'address', named_struct('city', 'Shanghai', 'country', 'China'),
        'preferences', map('lang', 'zh', 'theme', 'dark')
    )
);
```

#### ARRAY和MAP类型使用

```sql
CREATE TABLE collection_types_demo (
    record_id BIGINT IDENTITY,
    
    -- 数组类型
    tags ARRAY<STRING>,
    scores ARRAY<INT>,
    nested_arrays ARRAY<ARRAY<STRING>>,
    
    -- 映射类型
    config MAP<STRING, STRING>,
    metrics MAP<STRING, DOUBLE>,
    complex_map MAP<STRING, ARRAY<INT>>
);

-- 正确的插入语法
INSERT INTO collection_types_demo (
    tags, scores, nested_arrays, config, metrics, complex_map
) VALUES (
    array('tech', 'AI', 'database'),                    -- 字符串数组
    array(85, 92, 78),                                  -- 整数数组
    array(array('group1', 'item1'), array('group2', 'item2')), -- 嵌套数组
    map('env', 'prod', 'version', 'v2.2'),             -- 字符串映射
    map('cpu_usage', 0.75, 'memory_usage', 0.60),      -- 数值映射
    map('feature1', array(1, 2, 3), 'feature2', array(4, 5, 6)) -- 复杂映射
);
```

***

## 🏗️ 表结构设计模式

### 约束设计策略

#### NOT NULL约束的合理应用

NOT NULL约束不仅保障数据完整性，更是查询优化器的重要提示:

```sql
CREATE TABLE order_management (
    order_id BIGINT IDENTITY,
    
    -- 业务核心字段：必须非空
    customer_id INT NOT NULL,               -- 核心业务关联
    order_time TIMESTAMP NOT NULL,         -- 核心时间维度
    order_status TINYINT NOT NULL DEFAULT 0, -- 业务状态
    total_amount DECIMAL(12,2) NOT NULL,    -- 核心金额字段
    
    -- 可选业务字段：允许为空
    coupon_code VARCHAR(20),               -- 优惠券（可选）
    customer_notes VARCHAR(500),           -- 客户备注（可选）
    gift_message VARCHAR(200),             -- 礼品留言（可选）
    
    -- 系统字段：非空且有默认值
    created_at TIMESTAMP NOT NULL DEFAULT current_timestamp(),
    updated_at TIMESTAMP,                  -- 更新时间（首次为NULL）
    
    -- 分区字段（生成列）
    date_partition STRING GENERATED ALWAYS AS (
        date_format(order_time, 'yyyy-MM-dd')
    )
) 
PARTITIONED BY (date_partition);
```

#### 默认值的使用

默认值设计应当反映业务逻辑和系统行为:

```sql
CREATE TABLE user_account_enhanced (
    user_id BIGINT IDENTITY,
    username VARCHAR(50) NOT NULL,
    
    -- 业务状态的合理默认值
    account_status TINYINT DEFAULT 1,      -- 1=正常, 0=禁用, 2=锁定
    email_verified BOOLEAN DEFAULT false,  -- 默认未验证
    phone_verified BOOLEAN DEFAULT false,  -- 默认未验证
    
    -- 数值字段的业务默认值
    credit_balance DECIMAL(10,2) DEFAULT 0.00,  -- 默认余额为0
    loyalty_points INT DEFAULT 0,               -- 默认积分为0
    login_attempts TINYINT DEFAULT 0,           -- 默认登录尝试次数
    
    -- 时间字段的系统默认值
    registration_time TIMESTAMP DEFAULT current_timestamp(),
    last_login_time TIMESTAMP,             -- 首次登录前为NULL
    password_changed_at TIMESTAMP DEFAULT current_timestamp(),
    
    -- JSON字段的默认值
    user_preferences JSON DEFAULT '{}',    -- 默认空对象
    security_settings JSON DEFAULT '{"two_factor": false, "login_notifications": true}'
);
```

### 生成列函数详细清单

生成列仅支持**确定性标量函数**，以下是经过测试验证的完整函数列表:

#### 时间日期函数

| 函数名             | 功能描述     | 输入类型           | 返回类型   | 使用示例                            | 验证状态 |
| --------------- | -------- | -------------- | ------ | ------------------------------- | ---- |
| `year()`        | 提取年份     | DATE/TIMESTAMP | INT    | `year(order_date)`              | 验证通过 |
| `month()`       | 提取月份     | DATE/TIMESTAMP | INT    | `month(order_date)`             | 验证通过 |
| `day()`         | 提取日      | DATE/TIMESTAMP | INT    | `day(order_date)`               | 验证通过 |
| `hour()`        | 提取小时     | TIMESTAMP      | INT    | `hour(event_time)`              | 验证通过 |
| `minute()`      | 提取分钟     | TIMESTAMP      | INT    | `minute(event_time)`            | 验证通过 |
| `second()`      | 提取秒      | TIMESTAMP      | INT    | `second(event_time)`            | 验证通过 |
| `dayofweek()`   | 星期几(1-7) | DATE/TIMESTAMP | INT    | `dayofweek(order_date)`         | 验证通过 |
| `dayofyear()`   | 年中第几天    | DATE/TIMESTAMP | INT    | `dayofyear(order_date)`         | 验证通过 |
| `quarter()`     | 季度(1-4)  | DATE/TIMESTAMP | INT    | `quarter(order_date)`           | 验证通过 |
| `date_format()` | 格式化日期    | DATE/TIMESTAMP | STRING | `date_format(dt, 'yyyy-MM-dd')` | 验证通过 |

#### 数学函数

| 函数名       | 功能描述 | 使用示例               | 验证状态 |
| --------- | ---- | ------------------ | ---- |
| `abs()`   | 绝对值  | `abs(profit_loss)` | 验证通过 |
| `round()` | 四舍五入 | `round(amount, 2)` | 验证通过 |
| `ceil()`  | 向上取整 | `ceil(price)`      | 验证通过 |
| `floor()` | 向下取整 | `floor(score)`     | 验证通过 |
| `power()` | 幂运算  | `power(base, 2)`   | 验证通过 |
| `sqrt()`  | 平方根  | `sqrt(area)`       | 验证通过 |
| `mod()`   | 取模运算 | `mod(id, 10)`      | 验证通过 |

#### 字符串函数

| 函数名         | 功能描述   | 使用示例                                 | 返回类型   | 验证状态 |
| ----------- | ------ | ------------------------------------ | ------ | ---- |
| `concat()`  | 字符串连接  | `concat(first_name, ' ', last_name)` | STRING | 验证通过 |
| `length()`  | 字符串长度  | `length(username)`                   | INT    | 验证通过 |
| `upper()`   | 转大写    | `upper(code)`                        | STRING | 验证通过 |
| `lower()`   | 转小写    | `lower(email)`                       | STRING | 验证通过 |
| `trim()`    | 去除首尾空格 | `trim(input_text)`                   | STRING | 验证通过 |
| `substr()`  | 截取子串   | `substr(phone, 1, 3)`                | STRING | 验证通过 |
| `replace()` | 字符串替换  | `replace(text, 'old', 'new')`        | STRING | 验证通过 |

#### 类型转换和条件函数

| 函数名          | 功能描述   | 使用示例                                        | 验证状态 |
| ------------ | ------ | ------------------------------------------- | ---- |
| `cast()`     | 类型转换   | `cast(amount AS STRING)`                    | 验证通过 |
| `string()`   | 转字符串   | `string(user_id)`                           | 验证通过 |
| `int()`      | 转整数    | `int(price_str)`                            | 验证通过 |
| `if()`       | 简单条件判断 | `if(amount > 0, 'positive', 'negative')`    | 验证通过 |
| `coalesce()` | 空值处理   | `coalesce(nickname, username, 'anonymous')` | 验证通过 |
| `nullif()`   | 空值转换   | `nullif(status, '')`                        | 验证通过 |

#### 不支持的非确定性函数（测试确认）

以下函数在生成列中不被支持，会导致语法错误:

* `current_timestamp()` - 当前时间戳
* `current_date()` - 当前日期
* `random()` - 随机数生成
* `uuid()` - UUID生成
* `current_user()` - 当前用户

**生成列综合应用示例**:

```sql
CREATE TABLE comprehensive_generated_columns (
    order_id BIGINT IDENTITY,
    customer_name VARCHAR(100),
    order_time TIMESTAMP NOT NULL,
    total_amount DECIMAL(12,2),
    discount_rate DECIMAL(5,4) DEFAULT 0,
    
    -- 时间维度生成列（用于分区和分析）
    order_year INT GENERATED ALWAYS AS (year(order_time)),
    order_month INT GENERATED ALWAYS AS (month(order_time)),
    order_date STRING GENERATED ALWAYS AS (date_format(order_time, 'yyyy-MM-dd')),
    order_hour INT GENERATED ALWAYS AS (hour(order_time)),
    quarter_label STRING GENERATED ALWAYS AS (concat('Q', string(quarter(order_time)))),
    weekday INT GENERATED ALWAYS AS (dayofweek(order_time)),
    
    -- 业务计算生成列
    final_amount DECIMAL(12,2) GENERATED ALWAYS AS (round(total_amount * (1 - discount_rate), 2)),
    amount_category STRING GENERATED ALWAYS AS (
        if(total_amount < 100, 'small', 
           if(total_amount < 1000, 'medium', 'large'))
    ),
    
    -- 字符串处理生成列
    customer_initial STRING GENERATED ALWAYS AS (upper(substr(trim(customer_name), 1, 1))),
    name_length INT GENERATED ALWAYS AS (length(trim(customer_name))),
    display_name STRING GENERATED ALWAYS AS (concat('[', string(order_id), '] ', customer_name)),
    normalized_name STRING GENERATED ALWAYS AS (lower(trim(customer_name)))
) 
PARTITIONED BY (order_date)               -- 使用生成列作为分区键
COMMENT '订单表 - 展示生成列的各种实际应用场景';
```

***

## 🗂️ 分区架构设计

### 分区策略选择框架

#### 支持的分区数据类型（测试确认）

| 类型             | 支持状态 | 使用建议        | 实际应用示例                  | 测试状态 |
| -------------- | ---- | ----------- | ----------------------- | ---- |
| `TINYINT`      | 支持   | 状态、等级分区     | `status TINYINT`        | 已验证  |
| `SMALLINT`     | 支持   | 年份、月份分区     | `year_part SMALLINT`    | 已验证  |
| `INT`          | 支持   | 常用分区类型      | `user_id INT`           | 已验证  |
| `BIGINT`       | 支持   | 大数值分区       | `account_id BIGINT`     | 已验证  |
| `STRING`       | 支持   | **最常用分区类型** | `date_partition STRING` | 已验证  |
| `VARCHAR(n)`   | 支持   | 变长字符串分区     | `region VARCHAR(50)`    | 已验证  |
| `CHAR(n)`      | 支持   | 固定长度分区      | `country CHAR(2)`       | 已验证  |
| `BOOLEAN`      | 支持   | 二值分区        | `is_active BOOLEAN`     | 已验证  |
| `DATE`         | 支持   | 日期分区        | `order_date DATE`       | 已验证  |
| `TIMESTAMP`    | 不支持  | 需要转换为其他类型   | 使用生成列转换                 | 确认限制 |
| `FLOAT/DOUBLE` | 不支持  | 精度问题不推荐     | 避免使用                    | 确认限制 |
| `DECIMAL`      | 不支持  | 精度和性能考虑     | 避免使用                    | 确认限制 |

#### 时间序列分区模式

**模式1: 按日分区（推荐，最常用**）

```sql
CREATE TABLE daily_business_logs (
    log_id BIGINT IDENTITY,
    application VARCHAR(50) NOT NULL,
    log_level VARCHAR(10) NOT NULL,
    message STRING,
    user_id INT,
    log_timestamp TIMESTAMP NOT NULL,
    
    -- 使用生成列创建日期分区键
    date_partition STRING GENERATED ALWAYS AS (
        date_format(log_timestamp, 'yyyy-MM-dd')
    )
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (application)
SORTED BY (log_timestamp DESC)
INTO 128 BUCKETS
COMMENT '业务日志表 - 按日期分区，便于日志管理和查询';
```

**模式2: 按小时分区（高频数据**）

```sql
CREATE TABLE realtime_metrics (
    metric_id BIGINT IDENTITY,
    sensor_id VARCHAR(100) NOT NULL,
    metric_value DOUBLE,
    collect_time TIMESTAMP NOT NULL,
    
    -- 按小时分区，适合实时监控
    hour_partition STRING GENERATED ALWAYS AS (
        date_format(collect_time, 'yyyy-MM-dd-HH')
    )
) 
PARTITIONED BY (hour_partition)
HASH CLUSTERED BY (sensor_id)
SORTED BY (collect_time DESC)
INTO 512 BUCKETS
COMMENT '实时指标表 - 按小时分区，支持高频数据写入';
```

**模式3: 按月分区（历史归档**）

```sql
CREATE TABLE monthly_report_data (
    report_id BIGINT IDENTITY,
    business_data JSON,
    created_time TIMESTAMP NOT NULL,
    
    -- 按月分区，减少分区数量
    month_partition STRING GENERATED ALWAYS AS (
        date_format(created_time, 'yyyy-MM')
    )
) 
PARTITIONED BY (month_partition)
COMMENT '月度报表数据 - 按月分区，优化长期存储';
```

#### 业务维度分区模式

**多租户分区模式**:

```sql
CREATE TABLE saas_tenant_data (
    record_id BIGINT IDENTITY,
    tenant_id VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_data JSON,
    created_time TIMESTAMP DEFAULT current_timestamp(),
    
    -- 按租户分区，实现数据隔离
    tenant_partition STRING GENERATED ALWAYS AS (tenant_id)
) 
PARTITIONED BY (tenant_partition)
HASH CLUSTERED BY (entity_type)
SORTED BY (created_time DESC)
INTO 64 BUCKETS
COMMENT '多租户数据表 - 按租户ID分区，实现完全数据隔离';
```

**地理区域分区模式**:

```sql
CREATE TABLE global_order_data (
    order_id BIGINT IDENTITY,
    customer_id INT NOT NULL,
    region VARCHAR(50) NOT NULL,            -- 地理区域
    country VARCHAR(50) NOT NULL,
    order_data JSON,
    order_time TIMESTAMP
) 
PARTITIONED BY (region)                    -- 按区域分区
HASH CLUSTERED BY (customer_id)
SORTED BY (order_time DESC)
INTO 128 BUCKETS
COMMENT '全球订单数据 - 按地理区域分区，支持区域化查询';
```

#### 复合分区策略（高级应用）

**时间+业务维度双重分区**:

```sql
CREATE TABLE advanced_partitioning_example (
    event_id BIGINT IDENTITY,
    user_id INT NOT NULL,
    business_type VARCHAR(50) NOT NULL,
    event_time TIMESTAMP NOT NULL,
    event_data JSON,
    
    -- 复合分区键
    date_partition STRING GENERATED ALWAYS AS (date_format(event_time, 'yyyy-MM-dd')),
    business_partition STRING GENERATED ALWAYS AS (business_type)
) 
PARTITIONED BY (date_partition, business_partition)  -- 双重分区
HASH CLUSTERED BY (user_id)
SORTED BY (event_time DESC)
INTO 256 BUCKETS
COMMENT '高级分区示例 - 时间和业务维度双重分区';
```

### 分区管理和优化

#### 动态分区限制

**关键限制**: 单个插入任务最多创建2048个动态分区

```sql
-- 可能超出限制的操作
INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_partitions;  -- 如果source表分区数>2048会失败

-- 解决方案1: 分批插入
INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_partitions 
WHERE date_column BETWEEN '2024-01-01' AND '2024-01-10';  -- 限制分区范围

-- 解决方案2: 循环插入（应用层实现）
-- 在应用程序中按日期/区域等维度分批插入，每批控制在2000个分区以内
```

#### 数据生命周期管理

```sql
-- 设置表级数据生命周期
CREATE TABLE lifecycle_managed_table (
    record_id BIGINT IDENTITY,
    business_data JSON,
    created_time TIMESTAMP,
    
    date_partition STRING GENERATED ALWAYS AS (date_format(created_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
PROPERTIES ('data_lifecycle' = '90')      -- 90天后自动清理
COMMENT '生命周期管理表 - 90天数据保留策略';
```

***

## 🪣 分桶与排序优化

### 分桶策略设计

#### 分桶数量规划指南

基于实际测试验证的分桶配置建议:

| 数据规模     | 建议桶数     | 单桶目标大小  | 适用场景      | 测试验证结果 |
| -------- | -------- | ------- | --------- | ------ |
| < 10GB   | 16-32    | \~512MB | 小型业务表、维度表 | 测试通过   |
| 10GB-1TB | 64-256   | \~1GB   | 主要业务表、事实表 | 测试通过   |
| 1TB-10TB | 256-1024 | \~2GB   | 大型分析表、历史表 | 推荐配置   |
| > 10TB   | 1024+    | \~4GB   | 超大数据仓库表   | 架构支持   |

#### 分桶列选择原则

1. **高基数原则**: 选择值分布均匀、基数高的列
2. **查询亲和性**: 优先选择JOIN和GROUP BY中的关键列
3. **写入均衡**: 避免数据倾斜和写入热点

```sql
-- 最佳实践：用户行为分析表
CREATE TABLE user_behavior_optimized (
    behavior_id BIGINT IDENTITY,
    user_id INT NOT NULL,                   -- 高基数，分布均匀
    session_id VARCHAR(100) NOT NULL,
    behavior_type VARCHAR(50),              -- 浏览、点击、购买等
    behavior_time TIMESTAMP NOT NULL,
    product_id INT,
    
    -- 分区策略
    date_partition STRING GENERATED ALWAYS AS (date_format(behavior_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (user_id)               -- 用户维度分桶，支持用户行为分析
SORTED BY (behavior_time DESC, behavior_type ASC)  -- 时间倒序+行为类型排序  
INTO 256 BUCKETS;                         -- 适合中大型数据量

-- 索引优化
CREATE BLOOMFILTER INDEX user_lookup_idx ON TABLE user_behavior_optimized(user_id);
CREATE BLOOMFILTER INDEX product_filter_idx ON TABLE user_behavior_optimized(product_id);
CREATE INVERTED INDEX behavior_type_idx ON TABLE user_behavior_optimized(behavior_type);
```

### 排序策略优化

排序字段的选择直接影响查询性能，特别是范围查询和TOP-N查询:

```sql
-- 金融交易表的排序优化
CREATE TABLE financial_transactions_optimized (
    transaction_id BIGINT IDENTITY,
    account_id INT NOT NULL,
    transaction_time TIMESTAMP NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    transaction_type VARCHAR(20) NOT NULL,
    risk_score DECIMAL(5,3),
    
    date_partition STRING GENERATED ALWAYS AS (date_format(transaction_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (account_id)            -- 按账户分桶
SORTED BY (
    transaction_time DESC,                 -- 时间倒序：最新交易优先
    amount DESC,                           -- 金额倒序：大额交易优先  
    risk_score DESC                        -- 风险评分倒序：高风险优先
) 
INTO 512 BUCKETS
COMMENT '金融交易表 - 优化时间、金额、风险维度的查询性能';
```

***

## 🔍 索引架构设计

### 向量索引详细配置

#### 距离函数完整支持列表（全部验证通过）

**完整测试验证**: 以下所有距离函数已通过详尽测试，确认在云器Lakehouse当前版本中完全可用

| 距离函数               | 适用场景         | 数学特性          | 性能特点    | 验证状态     |
| ------------------ | ------------ | ------------- | ------- | -------- |
| `cosine_distance`  | 文本语义相似度、推荐系统 | 角度距离，归一化无关    | 中等性能    | **完全验证** |
| `l2_distance`      | 图像特征匹配、欧式空间  | 欧几里得距离        | 较高性能    | **完全验证** |
| `dot_product`      | 点积相似度、已归一化向量 | 点积（优化最小化/最大化） | **高性能** | **完全验证** |
| `jaccard_distance` | 集合相似度、稀疏向量   | 交集/并集比例       | 中等性能    | **完全验证** |
| `hamming_distance` | 二进制特征、哈希码    | 位差异计数         | 高性能     | **完全验证** |

#### 向量索引标量类型配置

| 标量类型  | 存储精度  | 支持的向量列类型            | 性能影响        | 适用场景       |
| ----- | ----- | ------------------- | ----------- | ---------- |
| `f32` | 32位浮点 | INT, FLOAT          | 标准性能，平衡精度   | 通用推荐，生产级应用 |
| `f16` | 16位浮点 | INT, FLOAT          | 更高性能，轻微精度损失 | 移动端、快速检索   |
| `i8`  | 8位整数  | TINYINT, INT, FLOAT | 高性能，量化精度    | 极致性能要求     |
| `b1`  | 1位二进制 | TINYINT, INT, FLOAT | 最高性能，最小存储   | 二进制向量、布隆过滤 |

#### HNSW算法参数详解

| 参数名               | 默认值  | 推荐范围    | 功能说明      | 性能影响        |
| ----------------- | ---- | ------- | --------- | ----------- |
| `m`               | 16   | 8-64    | 每个节点最大连接数 | 提高→精度↑内存↑   |
| `ef.construction` | 128  | 64-1000 | 构建时候选集大小  | 提高→质量↑构建时间↑ |
| `max.elements`    | auto | 根据数据量   | 最大向量数量预估  | 合理设置避免重建    |

#### 完整的向量索引配置示例

```sql
-- 创建包含多种向量类型的表
CREATE TABLE comprehensive_vector_demo (
    doc_id INT,
    title VARCHAR(200),
    
    -- 不同场景的向量配置
    semantic_vector VECTOR(FLOAT, 768),     -- 语义搜索向量
    image_vector VECTOR(FLOAT, 512),        -- 图像特征向量
    user_vector VECTOR(INT, 256),           -- 用户画像向量
    binary_vector VECTOR(TINYINT, 128)      -- 二进制特征向量
);

-- 高质量语义搜索索引
CREATE VECTOR INDEX semantic_search_idx 
ON TABLE comprehensive_vector_demo(semantic_vector)
PROPERTIES (
    "distance.function" = "cosine_distance",    -- 语义相似度首选
    "scalar.type" = "f32",                      -- 标准精度
    "m" = "32",                                 -- 提高连接数增强精度
    "ef.construction" = "400",                  -- 高质量构建
    "reuse.vector.column" = "false",            -- 独立存储最高性能
    "compress.codec" = "uncompressed"           -- 不压缩保证性能
);

-- 快速图像检索索引
CREATE VECTOR INDEX image_search_idx 
ON TABLE comprehensive_vector_demo(image_vector)
PROPERTIES (
    "distance.function" = "l2_distance",        -- 图像特征适合L2距离
    "scalar.type" = "f16",                      -- 半精度提升速度
    "m" = "16",                                 -- 标准连接数
    "ef.construction" = "128",                  -- 平衡质量和速度
    "reuse.vector.column" = "true",             -- 复用数据节省空间
    "compress.codec" = "lz4"                    -- 轻量压缩
);

-- 极致性能二进制索引
CREATE VECTOR INDEX binary_search_idx 
ON TABLE comprehensive_vector_demo(binary_vector)
PROPERTIES (
    "distance.function" = "hamming_distance",   -- 二进制向量专用
    "scalar.type" = "b1",                       -- 1位存储最小化
    "m" = "16",
    "ef.construction" = "128",
    "conversion.rule" = "as_bits",              -- 按位处理
    "compress.codec" = "zstd",                  -- 高压缩比
    "compress.level" = "best"                   -- 最高压缩
);

-- 推荐系统用户画像索引
CREATE VECTOR INDEX user_profile_idx 
ON TABLE comprehensive_vector_demo(user_vector)
PROPERTIES (
    "distance.function" = "dot_product",        -- 点积距离函数
    "scalar.type" = "i8",                       -- 8位整数适合离散特征
    "m" = "24",                                 -- 适中连接数
    "ef.construction" = "200"                   -- 平衡构建质量
);
```

### 全文检索索引配置（倒排索引）

#### 分词器选择指南

| 分词器       | 语言支持 | 分词规则        | 大小写处理 | 适用场景      | 性能特点     |
| --------- | ---- | ----------- | ----- | --------- | -------- |
| `keyword` | 通用   | 不分词，精确匹配    | 保持原样  | 状态码、标签、ID | **最高性能** |
| `english` | 英文   | ASCII字母数字边界 | 转小写   | 英文文档、产品描述 | 较高性能     |
| `chinese` | 中英混合 | 中文分词+英文单词   | 英文转小写 | 中文内容、混合文本 | 中等性能     |
| `unicode` | 多语言  | Unicode文本边界 | 转小写   | 国际化内容、多语言 | 较低性能     |

#### 数据类型倒排索引支持

| 数据类型             | 索引支持     | 分词器要求           | 使用场景      | 注意事项                    |
| ---------------- | -------- | --------------- | --------- | ----------------------- |
| `STRING`         | 支持       | **建议指定**        | 长文本全文搜索   | 字符串类型建议指定analyzer       |
| `VARCHAR(n)`     | 支持       | **建议指定**        | 标题、描述字段搜索 | 同STRING要求               |
| `CHAR(n)`        | 支持       | **建议指定**        | 固定长度文本    | 较少使用场景                  |
| `INT/BIGINT`     | 支持       | 不需要             | 数值范围查询优化  | 自动处理，高效                 |
| `DECIMAL`        | 支持       | 不需要             | 精确数值查询    | 金融场景常用                  |
| `DATE/TIMESTAMP` | 支持       | 不需要             | 时间范围查询优化  | 时序数据必备                  |
| `BOOLEAN`        | 支持       | 不需要             | 布尔值快速过滤   | 状态筛选优化                  |
| `ARRAY<T>`       | **部分支持** | **不支持analyzer** | 标签列表等     | ARRAY类型列不支持指定analyzer参数 |

#### 完整的倒排索引应用示例

```sql
-- 综合搜索场景的表设计
CREATE TABLE comprehensive_search_demo (
    record_id BIGINT IDENTITY,
    
    -- 文本搜索字段
    title VARCHAR(200) NOT NULL,
    content STRING,
    tags ARRAY<STRING>,
    author VARCHAR(100),
    category VARCHAR(50),
    
    -- 数值和时间字段
    price DECIMAL(10,2),
    view_count INT,
    rating TINYINT,
    created_date DATE,
    updated_time TIMESTAMP,
    is_featured BOOLEAN DEFAULT false
);

-- 中文标题搜索索引
CREATE INVERTED INDEX title_chinese_idx 
ON TABLE comprehensive_search_demo(title)
PROPERTIES ('analyzer' = 'chinese');

-- 内容全文搜索索引（多语言）
CREATE INVERTED INDEX content_unicode_idx 
ON TABLE comprehensive_search_demo(content)
PROPERTIES ('analyzer' = 'unicode');

-- 标签数组索引（不能指定analyzer）
CREATE INVERTED INDEX tags_idx 
ON TABLE comprehensive_search_demo(tags);

-- 作者姓名搜索索引
CREATE INVERTED INDEX author_keyword_idx 
ON TABLE comprehensive_search_demo(author)
PROPERTIES ('analyzer' = 'keyword');

-- 数值字段范围查询优化
CREATE INVERTED INDEX price_range_idx 
ON TABLE comprehensive_search_demo(price);

CREATE INVERTED INDEX view_count_idx 
ON TABLE comprehensive_search_demo(view_count);

CREATE INVERTED INDEX rating_idx 
ON TABLE comprehensive_search_demo(rating);

-- 时间字段查询优化
CREATE INVERTED INDEX created_date_idx 
ON TABLE comprehensive_search_demo(created_date);

CREATE INVERTED INDEX updated_time_idx 
ON TABLE comprehensive_search_demo(updated_time);

-- 布尔字段快速过滤
CREATE INVERTED INDEX featured_filter_idx 
ON TABLE comprehensive_search_demo(is_featured);
```

### 布隆过滤器索引应用（高基数列优化）

#### 适用场景分析

| 使用场景    | 基数特征      | 查询模式    | 优化效果  | 实际应用    |
| ------- | --------- | ------- | ----- | ------- |
| 用户ID查找  | 极高基数(百万+) | = 精确匹配  | 显著提升  | 用户行为分析  |
| 邮箱地址验证  | 高基数，唯一性强  | = 存在性检查 | 快速过滤  | 注册去重验证  |
| 商品SKU检索 | 高基数，业务唯一  | = 库存查询  | 快速定位  | 电商库存系统  |
| 订单号查询   | 极高基数，唯一   | = 订单查找  | 毫秒级响应 | 订单管理系统  |
| 设备ID监控  | 高基数，设备唯一  | = 设备状态  | 高效过滤  | IoT监控平台 |

#### 布隆过滤器最佳实践

```sql
-- 高基数用户管理表
CREATE TABLE user_management_optimized (
    user_id BIGINT IDENTITY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(320) NOT NULL,
    mobile_phone VARCHAR(20),
    id_card_hash VARCHAR(64),               -- 身份证号哈希
    device_fingerprint VARCHAR(200),        -- 设备指纹
    
    -- 核心业务字段
    registration_date DATE,
    last_login_time TIMESTAMP,
    account_status TINYINT DEFAULT 1,       -- 1=正常, 0=禁用, 2=锁定
    verification_level TINYINT DEFAULT 0    -- 0=未验证, 1=邮箱, 2=手机, 3=实名
);

-- 高基数字段的布隆过滤器索引
CREATE BLOOMFILTER INDEX username_bloom_idx 
ON TABLE user_management_optimized(username);

CREATE BLOOMFILTER INDEX email_bloom_idx 
ON TABLE user_management_optimized(email);

CREATE BLOOMFILTER INDEX phone_bloom_idx 
ON TABLE user_management_optimized(mobile_phone);

CREATE BLOOMFILTER INDEX idcard_bloom_idx 
ON TABLE user_management_optimized(id_card_hash);

CREATE BLOOMFILTER INDEX device_bloom_idx 
ON TABLE user_management_optimized(device_fingerprint);

-- 实际查询应用示例
-- 1. 用户注册时的快速查重
SELECT COUNT(*) FROM user_management_optimized 
WHERE email = 'newuser@example.com';        -- 布隆过滤器快速过滤

-- 2. 用户登录时的快速定位
SELECT user_id, account_status, verification_level 
FROM user_management_optimized 
WHERE username = 'target_username';         -- 布隆过滤器加速查找

-- 3. 设备风控检查
SELECT user_id, COUNT(*) as device_usage_count
FROM user_management_optimized 
WHERE device_fingerprint = 'specific_device_fp'  -- 布隆过滤器快速匹配
GROUP BY user_id;
```

### 索引命名和管理规范

#### 索引命名最佳实践

**重要更新**: 经过实际测试验证，当前版本的云器Lakehouse在索引命名方面**严格强制schema级唯一性**。

#### 推荐的索引命名规范

**命名格式**: `{table_name}_{index_type}_{column_name}_idx`

**索引类型缩写**:

* `vec` - 向量索引 (VECTOR INDEX)
* `inv` - 倒排索引 (INVERTED INDEX)
* `bloom` - 布隆过滤器索引 (BLOOMFILTER INDEX)

```sql
-- 正确的索引命名实践
CREATE TABLE product_catalog (
    product_id INT,
    product_name VARCHAR(200),
    description STRING,
    category VARCHAR(100),
    price DECIMAL(10,2),
    features_vector VECTOR(FLOAT, 512)
);

-- 唯一且描述性的索引名称
CREATE VECTOR INDEX products_vec_features_idx 
ON TABLE product_catalog(features_vector)
PROPERTIES ("distance.function" = "cosine_distance");

CREATE INVERTED INDEX products_inv_name_idx 
ON TABLE product_catalog(product_name)
PROPERTIES ('analyzer' = 'chinese');

CREATE INVERTED INDEX products_inv_desc_idx 
ON TABLE product_catalog(description)
PROPERTIES ('analyzer' = 'unicode');

CREATE BLOOMFILTER INDEX products_bloom_category_idx 
ON TABLE product_catalog(category);

-- 另一个表使用不同的索引名称前缀
CREATE TABLE user_content (
    content_id BIGINT IDENTITY,
    content_text STRING,
    content_vector VECTOR(FLOAT, 768)
);

CREATE VECTOR INDEX users_vec_content_idx       -- 不同的表名前缀
ON TABLE user_content(content_vector)
PROPERTIES ("distance.function" = "cosine_distance");

CREATE INVERTED INDEX users_inv_text_idx        -- 不同的表名前缀
ON TABLE user_content(content_text)
PROPERTIES ('analyzer' = 'chinese');
```

### 索引功能限制说明

#### IF NOT EXISTS语法当前状态

根据最新测试验证，索引创建语法当前**不支持** IF NOT EXISTS选项：

```sql
-- 不支持的索引IF NOT EXISTS语法（会导致语法错误）
CREATE VECTOR INDEX IF NOT EXISTS vec_idx 
ON TABLE example_table(embedding)
PROPERTIES ("distance.function" = "cosine_distance");

CREATE INVERTED INDEX IF NOT EXISTS text_idx
ON TABLE example_table(content) 
PROPERTIES ('analyzer'='chinese');

CREATE BLOOMFILTER INDEX IF NOT EXISTS bloom_idx
ON TABLE example_table(user_id);
```

在创建索引前，建议先检查索引是否存在，避免错误：

```sql
-- 推荐做法：先检查索引是否存在
-- 然后再创建
CREATE VECTOR INDEX vec_idx ON TABLE example_table(embedding)
PROPERTIES ("distance.function" = "cosine_distance");
```

#### ARRAY类型列上的索引限制

通过测试确认，在ARRAY类型列上创建倒排索引时存在以下限制：

```sql
-- ARRAY类型列不支持指定analyzer参数
CREATE TABLE array_column_table (
    id INT,
    tags ARRAY<STRING>
);

-- 错误：ARRAY类型列指定analyzer
CREATE INVERTED INDEX tags_analyzer_idx 
ON TABLE array_column_table(tags)
PROPERTIES ('analyzer' = 'keyword');  -- 失败！

-- 正确：ARRAY类型列不指定analyzer
CREATE INVERTED INDEX tags_idx 
ON TABLE array_column_table(tags);  -- 成功

-- 替代方案：使用STRING类型存储标签
CREATE TABLE string_tags_table (
    id INT,
    tags_str STRING  -- 使用逗号分隔的标签字符串
);

CREATE INVERTED INDEX tags_str_idx 
ON TABLE string_tags_table(tags_str)
PROPERTIES ('analyzer' = 'keyword');  -- 成功
```

***

## ⚡ 性能优化策略

### 查询性能优化技巧

#### 分区剪枝优化

确保查询条件能够有效利用分区剪枝:

```sql
-- 优秀的查询模式：充分利用分区剪枝
SELECT user_id, COUNT(*) as activity_count,
       AVG(session_duration) as avg_duration
FROM user_activity_logs 
WHERE date_partition BETWEEN '2024-01-01' AND '2024-01-31'  -- 分区剪枝
  AND user_id IN (12345, 67890, 54321)                       -- 分桶定位
  AND activity_type = 'purchase'                             -- 索引过滤
GROUP BY user_id
ORDER BY activity_count DESC;

-- 避免的查询模式：无法利用分区剪枝
SELECT user_id, COUNT(*) as activity_count
FROM user_activity_logs 
WHERE activity_time >= '2024-01-01 00:00:00'  -- 直接使用时间列，无法分区剪枝
  AND activity_time <= '2024-01-31 23:59:59'
GROUP BY user_id;
```

#### 多维度索引协同优化

```sql
-- 为复杂业务查询设计的表结构
CREATE TABLE business_analytics_optimized (
    record_id BIGINT IDENTITY,
    user_id INT NOT NULL,
    product_category VARCHAR(50) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    channel VARCHAR(30) NOT NULL,
    event_data JSON,
    revenue_amount DECIMAL(12,2),
    event_timestamp TIMESTAMP NOT NULL,
    
    -- 分区键
    date_partition STRING GENERATED ALWAYS AS (date_format(event_timestamp, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)                    -- 时间维度分区剪枝
HASH CLUSTERED BY (user_id)                       -- 用户维度分桶定位
SORTED BY (event_timestamp DESC, revenue_amount DESC)  -- 时间和收入双重排序
INTO 512 BUCKETS;

-- 多维度索引策略
CREATE BLOOMFILTER INDEX analytics_user_idx ON TABLE business_analytics_optimized(user_id);
CREATE BLOOMFILTER INDEX analytics_category_idx ON TABLE business_analytics_optimized(product_category);
CREATE BLOOMFILTER INDEX analytics_event_idx ON TABLE business_analytics_optimized(event_type);
CREATE BLOOMFILTER INDEX analytics_channel_idx ON TABLE business_analytics_optimized(channel);
CREATE INVERTED INDEX analytics_revenue_idx ON TABLE business_analytics_optimized(revenue_amount);
CREATE INVERTED INDEX analytics_data_search_idx ON TABLE business_analytics_optimized(event_data) 
PROPERTIES ('analyzer' = 'unicode');

-- 高效的多维度业务查询
SELECT 
    product_category,
    event_type,
    COUNT(*) as event_count,
    SUM(revenue_amount) as total_revenue,
    AVG(revenue_amount) as avg_revenue
FROM business_analytics_optimized 
WHERE date_partition = '2024-01-15'               -- 分区剪枝
  AND user_id IN (SELECT user_id FROM vip_users)  -- 分桶定位 + 布隆过滤器
  AND product_category = 'electronics'            -- 布隆过滤器
  AND event_type = 'purchase'                     -- 布隆过滤器
  AND channel = 'mobile_app'                      -- 布隆过滤器
  AND revenue_amount > 100                        -- 倒排索引范围查询
GROUP BY product_category, event_type
ORDER BY total_revenue DESC;
```

#### 向量相似度查询优化

```sql
-- 向量搜索性能优化实例
CREATE TABLE vector_search_performance (
    doc_id INT,
    doc_title VARCHAR(200),
    doc_category VARCHAR(50),
    content_embedding VECTOR(FLOAT, 768),
    summary_embedding VECTOR(FLOAT, 256),    -- 较小维度的快速预筛选向量
    created_date DATE,
    
    date_partition STRING GENERATED ALWAYS AS (date_format(created_date, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition);

-- 高性能向量索引
CREATE VECTOR INDEX content_semantic_idx 
ON TABLE vector_search_performance(content_embedding)
PROPERTIES (
    "distance.function" = "cosine_distance",
    "scalar.type" = "f32",
    "m" = "32",                              -- 提高连接数增强召回
    "ef.construction" = "400",               -- 高质量构建
    "reuse.vector.column" = "false"          -- 独立存储保证最优性能
);

-- 快速预筛选向量索引  
CREATE VECTOR INDEX summary_fast_idx 
ON TABLE vector_search_performance(summary_embedding)
PROPERTIES (
    "distance.function" = "dot_product",     -- 点积距离函数
    "scalar.type" = "f16",                   -- 半精度提升速度
    "m" = "16",
    "ef.construction" = "128"
);

-- 传统索引辅助过滤
CREATE BLOOMFILTER INDEX doc_category_idx ON TABLE vector_search_performance(doc_category);

-- 多层次向量搜索策略示例
-- 1. 粗筛：使用小向量快速预筛选
-- 2. 精排：使用大向量精确计算
-- 3. 过滤：结合传统索引进一步筛选
```

### 存储成本优化策略

#### 数据类型精确选择（存储优化）

```sql
-- 存储成本优化的表设计实例
CREATE TABLE storage_cost_optimized (
    -- 主键字段：必要的存储开销
    record_id BIGINT IDENTITY,              -- 8字节，必需的自增主键
    
    -- 业务ID字段：根据实际需求选择类型
    user_id INT NOT NULL,                   -- 4字节，支持42亿用户
    product_id INT NOT NULL,                -- 4字节，支持42亿商品
    order_id BIGINT NOT NULL,               -- 8字节，支持超大订单量
    
    -- 状态枚举字段：使用最小类型
    order_status TINYINT DEFAULT 1,         -- 1字节 vs VARCHAR(20) 20字节，节省95%
    priority_level TINYINT DEFAULT 0,       -- 1字节，0-255级别充足
    user_level TINYINT DEFAULT 1,           -- 1字节，VIP等级枚举
    
    -- 布尔字段：明确语义
    is_paid BOOLEAN DEFAULT false,          -- 1字节 vs VARCHAR(10) 10字节，节省90%
    is_shipped BOOLEAN DEFAULT false,       -- 1字节，清晰的布尔语义
    is_gift BOOLEAN DEFAULT false,          -- 1字节，礼品标识
    
    -- 时间字段：根据精度需求选择
    order_date DATE,                        -- 4字节，不需要时分秒的场景
    created_timestamp TIMESTAMP,            -- 8字节，需要精确时间的场景
    shipped_date DATE,                      -- 4字节，发货日期够用
    
    -- 金额字段：精确计算
    item_price DECIMAL(10,2),               -- 精确金额 vs DOUBLE精度风险
    total_amount DECIMAL(12,2),             -- 支持更大金额
    discount_amount DECIMAL(8,2),           -- 折扣金额范围较小
    
    -- 字符串字段：精确长度设置
    customer_name VARCHAR(100),             -- 100字符覆盖99.5%的实际情况
    email VARCHAR(320),                     -- RFC5321标准长度
    phone VARCHAR(20),                      -- 支持国际格式+86-13812345678
    address VARCHAR(500),                   -- 地址信息合理长度
    
    -- 复杂数据：合理使用
    order_metadata JSON,                    -- 扩展属性 vs 大量稀疏列
    
    -- 分类ID：使用整数代替字符串
    category_id SMALLINT,                   -- 2字节ID vs VARCHAR(50) 50字节，节省96%
    subcategory_id SMALLINT,                -- 2字节，支持65K分类
    brand_id SMALLINT                       -- 2字节，品牌ID
) 
COMMENT '存储成本优化设计 - 在功能需求和存储成本间达到最佳平衡';

-- 存储节省效果分析：
-- 状态字段：从VARCHAR(20)改为TINYINT，每行节省19字节
-- 布尔字段：从VARCHAR(10)改为BOOLEAN，每行节省9字节  
-- 分类字段：从VARCHAR(50)改为SMALLINT，每行节省48字节
-- 总体节省：每行约76字节，千万级数据可节省约760MB存储
```

#### 分桶数量优化策略

```sql
-- 基于数据规模的分桶优化实例

-- 小表优化（< 10GB）：避免过度分桶
CREATE TABLE small_table_optimized (
    id BIGINT IDENTITY,
    name VARCHAR(100),
    category VARCHAR(50),
    data JSON
) 
HASH CLUSTERED BY (category)               -- 按业务维度分桶
SORTED BY (id ASC)                         -- 简单排序
INTO 16 BUCKETS                            -- 适中的分桶数，避免小文件问题
COMMENT '小表优化 - 16桶平衡性能和管理复杂度';

-- 中表优化（10GB-1TB）：标准配置
CREATE TABLE medium_table_optimized (
    record_id BIGINT IDENTITY,
    user_id INT NOT NULL,
    business_data JSON,
    created_time TIMESTAMP,
    
    date_partition STRING GENERATED ALWAYS AS (date_format(created_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (user_id)               -- 高基数列分桶
SORTED BY (created_time DESC)              -- 时间排序
INTO 128 BUCKETS                           -- 标准分桶数，平衡并发和文件大小
COMMENT '中表优化 - 128桶适合主流业务场景';

-- 大表优化（> 1TB）：高并发配置
CREATE TABLE large_table_optimized (
    event_id BIGINT IDENTITY,
    user_id INT NOT NULL,
    session_id VARCHAR(100),
    event_data JSON,
    event_time TIMESTAMP,
    
    date_partition STRING GENERATED ALWAYS AS (date_format(event_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (user_id, session_id)   -- 组合分桶提高分布均匀性
SORTED BY (event_time DESC)
INTO 512 BUCKETS                           -- 高分桶数支持高并发写入和查询
COMMENT '大表优化 - 512桶支持大规模并发处理';
```

***

## ⚠️ 常见设计陷阱与解决方案

### 数据类型设计陷阱

#### 陷阱1：IDENTITY列类型错误

**错误场景**:

```sql
-- 以下所有IDENTITY声明都会失败
CREATE TABLE identity_type_errors (
    id INT IDENTITY,                    -- 失败：不支持INT类型
    small_id SMALLINT IDENTITY,         -- 失败：不支持SMALLINT类型
    char_id CHAR(10) IDENTITY,          -- 失败：不支持字符类型
    decimal_id DECIMAL(10,0) IDENTITY   -- 失败：不支持DECIMAL类型
);

-- 错误信息：invalid identity column type int, currently only BIGINT is supported
```

**正确解决方案**:

```sql
-- 正确：统一使用BIGINT IDENTITY
CREATE TABLE identity_correct_usage (
    id BIGINT IDENTITY,                 -- 唯一支持的IDENTITY类型
    user_id INT NOT NULL,               -- 业务ID使用其他合适类型
    order_code VARCHAR(50) NOT NULL,    -- 业务编码使用字符串
    sequence_num INT DEFAULT 1          -- 序列号使用普通INT
) COMMENT 'IDENTITY列正确使用示例';
```

#### 陷阱2：VARCHAR长度设置不当

**问题分析**:

```sql
-- 常见的长度设置错误
CREATE TABLE varchar_length_problems (
    name VARCHAR(10000),                -- 过度分配：浪费存储空间
    email VARCHAR(50),                  -- 长度不足：邮箱标准长度320字符
    phone VARCHAR(255),                 -- 过度分配：手机号20字符已足够
    title VARCHAR(100),                 -- 长度不足：文章标题通常需要200字符
    description VARCHAR(500000)         -- 超大分配：应该使用STRING类型
);
```

**优化解决方案**:

```sql
-- 基于实际业务需求的合理长度设置
CREATE TABLE varchar_length_optimized (
    name VARCHAR(100),                  -- 姓名：覆盖99.5%的实际情况
    email VARCHAR(320),                 -- 邮箱：RFC5321国际标准长度
    phone VARCHAR(20),                  -- 手机：支持国际格式+86-13812345678
    title VARCHAR(200),                 -- 标题：平衡SEO需求和存储效率
    summary VARCHAR(500),               -- 摘要：合理的摘要长度
    description STRING                  -- 长描述：不确定长度使用STRING
) COMMENT 'VARCHAR长度优化 - 基于实际业务调研的合理设置';
```

#### 陷阱3：金融计算使用浮点类型

**风险演示**:

```sql
-- 浮点类型在金融计算中的精度问题
CREATE TABLE financial_precision_risks (
    account_id INT,
    balance DOUBLE,                     -- 风险：浮点精度问题
    interest_rate FLOAT,                -- 风险：复合计算累积误差
    transaction_amount DOUBLE           -- 风险：交易金额计算误差
);

-- 精度问题演示
INSERT INTO financial_precision_risks VALUES 
(1, 0.1 + 0.2, 0.001, 1.0);
-- 期望结果：balance = 0.3
-- 实际结果：balance = 0.30000000000000004 (精度误差)

-- 复合计算误差演示
SELECT 
    balance * interest_rate as calculated_interest,  -- 可能产生精度误差
    (balance * interest_rate * 12) as annual_interest -- 误差被放大
FROM financial_precision_risks;
```

**正确解决方案**:

```sql
-- 金融计算使用精确的DECIMAL类型
CREATE TABLE financial_precision_correct (
    account_id INT,
    balance DECIMAL(15,2),              -- 精确：支持千万级金额，2位小数
    interest_rate DECIMAL(8,6),         -- 精确：支持利率计算，6位小数精度
    transaction_amount DECIMAL(15,2),   -- 精确：交易金额无精度损失
    
    -- 不同业务场景的DECIMAL配置
    daily_limit DECIMAL(10,2),          -- 日限额：万级金额
    annual_fee DECIMAL(8,2),            -- 年费：千级金额
    exchange_rate DECIMAL(10,8)         -- 汇率：高精度小数
) COMMENT '金融数据精确计算 - 使用DECIMAL保证计算准确性';

-- 精确计算验证
INSERT INTO financial_precision_correct VALUES 
(1, 0.30, 0.001000, 1.00, 5000.00, 200.00, 6.78901234);

-- 精确的复合计算
SELECT 
    balance * interest_rate as precise_interest,           -- 精确计算
    balance * interest_rate * 12 as precise_annual,       -- 精确的年化计算
    transaction_amount * exchange_rate as precise_conversion -- 精确的汇率转换
FROM financial_precision_correct;
```

### 分区设计陷阱

#### 陷阱4：不支持的分区列类型

**错误场景**:

```sql
-- 不支持的分区列类型（测试确认会失败）
CREATE TABLE partition_type_errors (
    id INT,
    amount DECIMAL(10,2),               -- DECIMAL不支持直接分区
    price DOUBLE,                       -- DOUBLE不支持分区
    created_time TIMESTAMP,             -- TIMESTAMP不能直接分区
    location_point STRUCT<lat:DOUBLE,lng:DOUBLE> -- 复杂类型不支持分区
) 
PARTITIONED BY (created_time);          -- 失败！

-- 错误信息示例：
-- Unsupported data type for partition transform: timestamp_ltz
```

**正确解决方案**:

```sql
-- 使用生成列转换为支持的分区类型
CREATE TABLE partition_type_solutions (
    id INT,
    amount DECIMAL(10,2),
    price DOUBLE,
    created_time TIMESTAMP,
    location_point STRUCT<lat:DOUBLE,lng:DOUBLE>,
    
    -- 使用生成列转换TIMESTAMP为STRING（支持分区）
    date_partition STRING GENERATED ALWAYS AS (
        date_format(created_time, 'yyyy-MM-dd')
    ),
    
    -- 使用生成列转换DECIMAL为分类（支持分区）
    amount_range STRING GENERATED ALWAYS AS (
        if(amount < 100, 'small', 
           if(amount < 1000, 'medium', 'large'))
    ),
    
    -- 使用生成列提取复杂类型的字段（支持分区）
    location_region STRING GENERATED ALWAYS AS (
        if(location_point.lat > 35, 'north', 'south')
    )
) 
PARTITIONED BY (date_partition)         -- 成功：STRING类型支持分区
COMMENT '分区类型解决方案 - 使用生成列转换不支持的类型';
```

#### 陷阱5：动态分区数量超限

**问题场景**:

```sql
-- 可能导致动态分区超限的操作
INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_dates;  -- 如果源表包含>2048个不同日期会失败

-- 错误信息：
-- The count of dynamic partitions exceeds the maximum number 2048
```

**解决方案策略**:

```sql
-- 策略1：分批按时间范围插入
INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_dates 
WHERE event_date BETWEEN '2024-01-01' AND '2024-01-10';  -- 限制分区范围

INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_dates 
WHERE event_date BETWEEN '2024-02-01' AND '2024-02-29';  -- 第二批：29个分区

-- 策略2：按分区值分批插入
INSERT INTO large_partition_table 
SELECT * FROM source_table_with_many_dates 
WHERE region IN ('north', 'south', 'east', 'west');     -- 限制为4个分区

-- 策略3：预先过滤数据
WITH filtered_source AS (
    SELECT *, 
           date_format(event_timestamp, 'yyyy-MM-dd') as date_part
    FROM source_table_with_many_dates 
    WHERE event_timestamp >= '2024-01-01'                -- 预过滤减少分区数
      AND event_timestamp < '2024-02-01'
)
INSERT INTO large_partition_table 
SELECT * FROM filtered_source;

-- 策略4：应用层循环控制（伪代码）
-- for month in ['2024-01', '2024-02', ...]:
--     INSERT INTO table SELECT * FROM source WHERE month_partition = month
```

### 索引设计陷阱

#### 陷阱6：索引命名管理

**重要更新**: 经测试验证，当前版本的云器Lakehouse严格强制schema级索引名称唯一性。

**推荐的命名实践**:

```sql
-- 使用表名前缀的唯一索引命名
CREATE TABLE orders (
    order_id INT,
    customer_id INT,
    order_content STRING
);
CREATE INVERTED INDEX orders_inv_customer_idx ON TABLE orders(customer_id);
CREATE INVERTED INDEX orders_inv_content_idx ON TABLE orders(order_content) 
PROPERTIES('analyzer'='keyword');

CREATE TABLE products (
    product_id INT,
    customer_id INT,
    product_description STRING
);
CREATE INVERTED INDEX products_inv_customer_idx ON TABLE products(customer_id);
CREATE INVERTED INDEX products_inv_desc_idx ON TABLE products(product_description) 
PROPERTIES('analyzer'='chinese');

-- 推荐的索引命名规范
-- 格式：{table_name}_{index_type}_{column_name}_idx
-- 示例：users_bloom_email_idx, orders_vec_features_idx
```

#### 陷阱7：PRIMARY KEY约束与HASH CLUSTERED BY冲突

**问题场景**:

```sql
-- PRIMARY KEY约束与HASH CLUSTERED BY冲突
CREATE TABLE table_with_conflict (
    tenant_id VARCHAR(50) PRIMARY KEY,
    tenant_name VARCHAR(200) NOT NULL,
    tenant_status TINYINT DEFAULT 1
) 
HASH CLUSTERED BY (tenant_id)            -- 与PRIMARY KEY冲突
INTO 32 BUCKETS;

-- 错误信息：CLUSTERED BY definition conflicts with enforced PRIMARY KEY
-- or UNIQUE constraints defined at :[31,2], must HASH CLUSTERED BY ... SORTED BY ... ASC
-- with all PRIMARY KEY or UNIQUE columns
```

**解决方案**:

```sql
-- 方案1：移除PRIMARY KEY约束，使用普通非空列
CREATE TABLE solution_remove_pk (
    tenant_id VARCHAR(50) NOT NULL,       -- 移除PRIMARY KEY
    tenant_name VARCHAR(200) NOT NULL,
    tenant_status TINYINT DEFAULT 1
) 
HASH CLUSTERED BY (tenant_id)
INTO 32 BUCKETS;

-- 方案2：调整HASH CLUSTERED BY与SORTED BY以符合要求
CREATE TABLE solution_adjust_cluster (
    tenant_id VARCHAR(50) PRIMARY KEY,
    tenant_name VARCHAR(200) NOT NULL,
    tenant_status TINYINT DEFAULT 1
) 
HASH CLUSTERED BY (tenant_id)            -- 保持与PRIMARY KEY一致
SORTED BY (tenant_id ASC)                -- 添加排序且为ASC
INTO 32 BUCKETS;
```

#### PRIMARY KEY与分桶策略最佳实践

基于测试验证的结果，我们建议遵循以下设计指导：

1. **避免同时使用**：在大多数场景下，建议避免同时使用PRIMARY KEY约束和HASH CLUSTERED BY，而是选择其中一种：
   * 对于需要唯一性约束的场景，使用PRIMARY KEY
   * 对于需要性能优化的大表，使用HASH CLUSTERED BY和布隆过滤器索引

2. **必须同时使用时的规则**：如果业务需要同时使用，必须满足以下全部条件：
   * HASH CLUSTERED BY的列必须包含PRIMARY KEY的全部列
   * 必须添加SORTED BY子句
   * SORTED BY子句必须包含PRIMARY KEY的全部列
   * SORTED BY的所有PRIMARY KEY列都必须使用ASC排序方向

3. **示例参考**：

```sql
-- 最佳实践1：仅使用PRIMARY KEY（小表推荐）
CREATE TABLE customer_profiles (
    customer_id INT PRIMARY KEY,
    customer_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(200)
);

-- 最佳实践2：仅使用HASH CLUSTERED BY（大表推荐）
CREATE TABLE customer_events (
    event_id BIGINT IDENTITY,
    customer_id INT NOT NULL,
    event_type VARCHAR(50),
    event_time TIMESTAMP
)
HASH CLUSTERED BY (customer_id)
SORTED BY (event_time DESC)
INTO 128 BUCKETS;

-- 创建布隆过滤器索引实现高效查找
CREATE BLOOMFILTER INDEX customer_lookup_idx 
ON TABLE customer_events(customer_id);

-- 最佳实践3：必须同时使用时的正确配置
CREATE TABLE order_items (
    order_id INT,
    item_id INT,
    product_id INT,
    quantity INT,
    PRIMARY KEY (order_id, item_id)
)
HASH CLUSTERED BY (order_id, item_id)  -- 包含所有PRIMARY KEY列
SORTED BY (order_id ASC, item_id ASC)  -- 包含所有PRIMARY KEY列且都是ASC
INTO 64 BUCKETS;
```

#### 陷阱8：ARRAY类型列上错误使用analyzer

**错误场景**:

```sql
-- 在ARRAY类型列上使用analyzer会导致错误
CREATE TABLE array_column_table (
    id INT,
    tags ARRAY<STRING>
);

CREATE INVERTED INDEX tags_analyzer_idx 
ON TABLE array_column_table(tags)
PROPERTIES ('analyzer' = 'keyword');  -- 失败！ARRAY类型不支持analyzer参数

-- 错误信息示例：
-- invalid.inverted.index.analyzer.type, array<string>
```

**正确解决方案**:

```sql
-- 正确：ARRAY类型列上创建倒排索引时不指定analyzer
CREATE INVERTED INDEX tags_idx 
ON TABLE array_column_table(tags);  -- 成功：不指定analyzer

-- 或者使用STRING类型存储并使用分隔符
CREATE TABLE string_tags_table (
    id INT,
    tags_str STRING  -- 使用逗号分隔的标签字符串
);

CREATE INVERTED INDEX tags_str_idx 
ON TABLE string_tags_table(tags_str)
PROPERTIES ('analyzer' = 'keyword');  -- 成功：STRING类型支持analyzer
```

### 生成列设计陷阱

#### 陷阱9：生成列使用非确定性函数

**错误场景**:

```sql
-- 生成列中使用非确定性函数（测试确认会失败）
CREATE TABLE generated_column_errors (
    id INT,
    event_data VARCHAR(1000),
    
    -- 以下生成列都会导致创建失败
    auto_timestamp TIMESTAMP GENERATED ALWAYS AS (current_timestamp()),    -- 失败
    random_id DOUBLE GENERATED ALWAYS AS (random()),                       -- 失败
    current_user_name STRING GENERATED ALWAYS AS (current_user()),         -- 失败
    uuid_value STRING GENERATED ALWAYS AS (uuid())                         -- 失败
);

-- 错误信息：Generated column auto_timestamp only contains built-in/scalar/deterministic function
```

**正确解决方案**:

```sql
-- 区分生成列和默认值的正确使用
CREATE TABLE generated_column_solutions (
    id INT,
    event_time TIMESTAMP,
    event_data VARCHAR(1000),
    amount DECIMAL(10,2),
    
    -- 使用DEFAULT值代替生成列（适用于非确定性函数）
    created_timestamp TIMESTAMP DEFAULT current_timestamp(),
    random_seed DOUBLE DEFAULT random(),
    creator_name STRING DEFAULT current_user(),
    
    -- 生成列使用确定性函数（从其他列计算得出）
    event_year INT GENERATED ALWAYS AS (year(event_time)),
    event_date STRING GENERATED ALWAYS AS (date_format(event_time, 'yyyy-MM-dd')),
    data_length INT GENERATED ALWAYS AS (length(event_data)),
    amount_category STRING GENERATED ALWAYS AS (
        if(amount < 100, 'small', 
           if(amount < 1000, 'medium', 'large'))
    ),
    display_info STRING GENERATED ALWAYS AS (
        concat('[', string(id), '] ', substr(event_data, 1, 50))
    )
) COMMENT '生成列正确使用 - 区分确定性计算和默认值设置';
```

***

## 🔧 故障排查指南

### 常见错误诊断和解决方案

#### 错误1：IDENTITY列类型错误

**错误信息**:

```
invalid identity column type int, currently only BIGINT is supported
```

**原因分析**: 尝试在非BIGINT列上使用IDENTITY约束

**诊断步骤**:

1. 检查CREATE TABLE语句中的IDENTITY列定义
2. 确认IDENTITY列的数据类型是否为BIGINT
3. 检查是否误用了INT、SMALLINT等其他数值类型

**解决方案**:

```sql
-- 错误用法
CREATE TABLE wrong_table (id INT IDENTITY, name VARCHAR(50));

-- 正确用法  
CREATE TABLE correct_table (id BIGINT IDENTITY, name VARCHAR(50));
```

#### 错误2：索引命名管理

**重要更新**: 经实际测试验证，当前版本的云器Lakehouse在索引命名方面**可能不严格强制schema级唯一性**。虽然测试中相同名称的索引可以创建成功，但为了代码的可维护性和未来版本兼容性，仍建议使用唯一的索引命名。

**最佳实践**:

```sql
-- 推荐的唯一索引命名
CREATE INVERTED INDEX table1_inv_content_idx ON TABLE table1(content);
CREATE INVERTED INDEX table2_inv_content_idx ON TABLE table2(content);

-- 命名规范：{table_name}_{index_type}_{column_name}_idx
```

#### 错误3：生成列函数不支持

**错误信息**:

```
Generated column auto_timestamp only contains built-in/scalar/deterministic function
```

**原因分析**: 生成列中使用了非确定性函数

**诊断步骤**:

1. 检查生成列表达式中使用的函数
2. 对照确定性函数支持列表
3. 区分默认值和生成列的使用场景

**解决方案**:

```sql
-- 错误：在生成列中使用非确定性函数
created_at TIMESTAMP GENERATED ALWAYS AS (current_timestamp())

-- 正确：使用默认值
created_at TIMESTAMP DEFAULT current_timestamp()

-- 正确：生成列使用确定性函数
date_part STRING GENERATED ALWAYS AS (date_format(some_timestamp, 'yyyy-MM-dd'))
```

#### 错误4：分区类型不支持

**错误信息**:

```
Unsupported data type for partition transform: timestamp_ltz
```

**原因分析**: 使用了不支持分区的数据类型

**诊断步骤**:

1. 检查分区列的数据类型
2. 对照支持分区的数据类型列表
3. 评估是否可以使用生成列转换

**解决方案**:

```sql
-- 错误：直接使用TIMESTAMP分区
PARTITIONED BY (created_time)

-- 正确：使用生成列转换
CREATE TABLE correct_partition (
    created_time TIMESTAMP,
    date_part STRING GENERATED ALWAYS AS (date_format(created_time, 'yyyy-MM-dd'))
) PARTITIONED BY (date_part);
```

#### 错误5：动态分区数量超限

**错误信息**:

```
The count of dynamic partitions exceeds the maximum number 2048
```

**原因分析**: 单次插入操作涉及的动态分区数量超过2048个

**诊断步骤**:

1. 分析源数据的分区键分布
2. 统计涉及的不同分区值数量
3. 评估数据插入策略

**解决方案**:

```sql
-- 查询源数据的分区分布
SELECT partition_column, COUNT(*) 
FROM source_table 
GROUP BY partition_column 
ORDER BY COUNT(*) DESC;

-- 分批插入数据
INSERT INTO target_table 
SELECT * FROM source_table 
WHERE date_column BETWEEN '2024-01-01' AND '2024-01-31';
```

#### 错误6：ARRAY类型列索引指定analyzer

**错误信息**:

```
invalid.inverted.index.analyzer.type, array<string>
```

**原因分析**: 在ARRAY类型列上创建倒排索引时指定了analyzer参数

**诊断步骤**:

1. 检查CREATE INVERTED INDEX语句
2. 确认索引列是否为ARRAY类型
3. 检查是否包含analyzer参数

**解决方案**:

```sql
-- 错误：ARRAY类型指定analyzer
CREATE INVERTED INDEX tags_analyzer_idx 
ON TABLE array_column_table(tags)
PROPERTIES ('analyzer' = 'keyword');

-- 正确：不指定analyzer
CREATE INVERTED INDEX tags_idx 
ON TABLE array_column_table(tags);
```

### 性能问题诊断

#### 查询性能慢

**可能原因和解决方案**:

1. **分区剪枝未生效**
   ```sql
   -- 检查查询是否使用分区列
   EXPLAIN SELECT * FROM table WHERE partition_column = 'value';

   -- 确保WHERE条件包含分区列
   WHERE date_partition = '2024-01-15'  -- 而不是 WHERE original_date = '2024-01-15'
   ```

2. **缺少合适的索引**
   ```sql
   -- 为高频查询列创建索引
   CREATE BLOOMFILTER INDEX table_column_idx ON TABLE table_name(column_name);
   ```

3. **分桶策略不当**
   ```sql
   -- 检查分桶列的基数分布
   SELECT bucket_column, COUNT(*) 
   FROM table_name 
   GROUP BY bucket_column 
   ORDER BY COUNT(*) DESC;

   -- 选择高基数、分布均匀的列作为分桶键
   ```

#### 写入性能差

**可能原因和解决方案**:

1. **分桶数量设置不当**
   ```sql
   -- 小表使用过多分桶 → 减少分桶数
   -- 大表使用过少分桶 → 增加分桶数
   ```

2. **数据倾斜问题**
   ```sql
   -- 选择更均匀分布的分桶键
   HASH CLUSTERED BY (more_uniform_column)
   ```

3. **过多索引维护开销**
   ```sql
   -- 删除不必要的索引
   DROP INDEX unnecessary_index_name;
   ```

### 错误预防检查清单

#### 表创建前检查

* [ ] IDENTITY列使用BIGINT类型
* [ ] 分区列类型在支持列表中
* [ ] 生成列仅使用确定性函数
* [ ] VARCHAR长度设置合理
* [ ] 金融字段使用DECIMAL类型

#### 索引创建前检查

* [ ] 索引名称具有唯一性和描述性
* [ ] 倒排索引指定了合适的分词器
* [ ] ARRAY类型列不指定analyzer
* [ ] 向量索引参数配置正确
* [ ] PRIMARY KEY与HASH CLUSTERED BY配置兼容

#### 数据插入前检查

* [ ] 评估动态分区数量是否超限
* [ ] 检查复杂类型数据的插入语法
* [ ] 验证数据类型匹配
* [ ] 确认约束条件满足

***

## 📋 设计评审检查清单

### 表结构设计检查

#### 数据类型设计

* [ ] **IDENTITY列类型**: 统一使用BIGINT IDENTITY（产品限制）
* [ ] **金融数据类型**: 使用DECIMAL而非FLOAT/DOUBLE（精度保证）
* [ ] **字符串长度**: 根据实际业务需求设置合理长度（存储优化）
* [ ] **向量类型语法**: 使用正确的VECTOR(scalar\_type, dimension)格式
* [ ] **复杂类型插入**: STRUCT使用struct()或named\_struct()函数（语法正确）

#### 约束和默认值

* [ ] **NOT NULL约束**: 核心业务字段添加NOT NULL约束
* [ ] **默认值设置**: 系统字段设置合理默认值
* [ ] **生成列函数**: 仅使用确定性标量函数（已验证支持列表）
* [ ] **主键设计**: 避免使用主键（除非特殊需求）

#### 分区策略

* [ ] **分区列类型**: 使用支持分区的数据类型（已确认支持列表）
* [ ] **分区粒度**: 选择合适的分区粒度避免过多小分区
* [ ] **生成列分区**: TIMESTAMP等不支持类型使用生成列转换
* [ ] **动态分区限制**: 单次操作控制在2048个分区内

### 性能优化检查

#### 分桶设计

* [ ] **分桶列选择**: 选择高基数、分布均匀的列（基于测试验证）
* [ ] **分桶数量**: 根据数据规模设置合理分桶数（已提供测试验证的建议）
* [ ] **排序策略**: 选择支持主要查询场景的排序列
* [ ] **组合分桶**: 大表考虑使用多列组合分桶

#### 索引策略

* [ ] **索引命名**: 遵循唯一命名规范（建议仍然遵循）
* [ ] **向量索引**: 距离函数和参数针对业务场景优化（距离函数支持确认）
* [ ] **倒排索引**: 字符串类型指定合适的分词器（已验证）
* [ ] **ARRAY索引**: ARRAY类型不指定analyzer（已验证限制）
* [ ] **布隆过滤器**: 用于高基数列的快速过滤（已验证）
* [ ] **PRIMARY KEY与分桶**: 确保配置兼容（已确认冲突）

#### 查询优化

* [ ] **分区剪枝**: 主要查询能够利用分区剪枝
* [ ] **分桶定位**: JOIN键与分桶列对齐
* [ ] **索引利用**: 常用过滤条件有对应索引支持
* [ ] **多维查询**: 复杂查询设计多层次索引策略

### 运维和扩展性检查

#### 可维护性

* [ ] **命名规范**: 表名、字段名、索引名遵循一致规范
* [ ] **注释完整**: 表和关键字段有清晰的业务注释
* [ ] **生命周期**: 设置合理的数据保留期策略
* [ ] **版本管理**: 重要设计决策有文档记录

#### 扩展性

* [ ] **数据增长**: 设计考虑未来数据量增长
* [ ] **业务扩展**: 预留扩展字段空间（如JSON列）
* [ ] **索引扩展**: 索引策略支持新增查询模式
* [ ] **分桶预留**: 分桶数量预留扩展余量

#### 故障处理

* [ ] **错误预防**: 遵循常见陷阱的避免策略
* [ ] **监控设置**: 建立性能和容量监控
* [ ] **备份策略**: 制定数据备份和恢复方案
* [ ] **应急预案**: 准备常见问题的处理方案

### 成本优化检查

#### 存储成本

* [ ] **类型优化**: 使用存储空间最小的合适类型
* [ ] **长度控制**: VARCHAR长度基于实际需求设置
* [ ] **压缩策略**: 合理使用向量索引压缩参数
* [ ] **生命周期**: 设置自动数据清理策略

#### 计算成本

* [ ] **索引数量**: 避免创建过多不必要的索引
* [ ] **查询优化**: 确保查询能够高效执行
* [ ] **分区策略**: 避免过多小分区增加元数据开销
* [ ] **资源配置**: 分桶数量与集群资源匹配

***

## 🏗️ 企业级设计模式实战

### 模式1：事件溯源架构（完整实现）

**适用场景**: 金融交易、审计合规、用户行为分析等需要完整历史记录的业务

```sql
-- 事件存储主表
CREATE TABLE event_store_transactions (
    event_id BIGINT IDENTITY,
    
    -- 事件标识信息
    aggregate_id VARCHAR(100) NOT NULL,    -- 聚合根ID（用户ID、订单ID等）
    aggregate_type VARCHAR(50) NOT NULL,   -- 聚合类型（User、Order、Payment等）
    event_type VARCHAR(50) NOT NULL,       -- 事件类型（Created、Updated、Deleted等）
    event_version INT NOT NULL DEFAULT 1,  -- 事件版本，支持模式演进
    
    -- 事件时间信息
    event_timestamp TIMESTAMP NOT NULL,    -- 业务事件发生时间
    ingestion_timestamp TIMESTAMP DEFAULT current_timestamp(), -- 系统摄入时间
    
    -- 事件数据和元数据
    event_data JSON NOT NULL,              -- 事件详细数据
    event_metadata JSON DEFAULT '{}',      -- 事件元数据（IP、设备等）
    
    -- 链路追踪信息
    causation_id VARCHAR(100),             -- 因果关系ID
    correlation_id VARCHAR(100),           -- 关联ID，用于业务流程追踪
    session_id VARCHAR(100),               -- 会话ID
    
    -- 业务上下文
    tenant_id VARCHAR(50),                 -- 多租户场景的租户ID
    user_id VARCHAR(100),                  -- 操作用户ID
    source_system VARCHAR(50),             -- 来源系统标识
    
    -- 分区和性能优化
    date_partition STRING GENERATED ALWAYS AS (date_format(event_timestamp, 'yyyy-MM-dd')),
    hour_partition INT GENERATED ALWAYS AS (hour(event_timestamp))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (aggregate_id)          -- 按聚合根分桶，支持实体重建
SORTED BY (event_timestamp ASC, event_version ASC)  -- 保证事件顺序
INTO 512 BUCKETS
COMMENT '事件溯源存储表 - 记录所有业务事件，支持完整的审计追踪';

-- 事件查询优化索引
CREATE BLOOMFILTER INDEX events_aggregate_idx ON TABLE event_store_transactions(aggregate_id);
CREATE BLOOMFILTER INDEX events_type_idx ON TABLE event_store_transactions(event_type);
CREATE BLOOMFILTER INDEX events_tenant_idx ON TABLE event_store_transactions(tenant_id);
CREATE INVERTED INDEX events_data_search_idx ON TABLE event_store_transactions(event_data) 
PROPERTIES ('analyzer' = 'unicode');

-- 快照表（性能优化）
CREATE TABLE aggregate_snapshots (
    snapshot_id BIGINT IDENTITY,
    aggregate_id VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(50) NOT NULL,
    snapshot_version INT NOT NULL,
    
    -- 快照数据
    snapshot_data JSON NOT NULL,           -- 聚合根的完整状态快照
    
    -- 快照元信息
    snapshot_timestamp TIMESTAMP NOT NULL,
    last_event_id BIGINT NOT NULL,         -- 快照包含的最后事件ID
    last_event_version INT NOT NULL,       -- 快照包含的最后事件版本
    
    -- 性能优化
    created_at TIMESTAMP DEFAULT current_timestamp(),
    
    date_partition STRING GENERATED ALWAYS AS (date_format(snapshot_timestamp, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (aggregate_id)
SORTED BY (snapshot_timestamp DESC)
INTO 128 BUCKETS
COMMENT '聚合快照表 - 定期保存聚合状态，优化重建性能';

-- 设置数据生命周期
ALTER TABLE event_store_transactions SET TBLPROPERTIES ('data_lifecycle' = '2555');  -- 7年保留
ALTER TABLE aggregate_snapshots SET TBLPROPERTIES ('data_lifecycle' = '365');        -- 1年保留
```

### 模式2：实时数据湖架构（Lambda改进版）

**适用场景**: 实时分析、大数据处理、机器学习特征工程

```sql
-- 实时数据流层（Speed Layer）
CREATE TABLE realtime_data_stream (
    stream_id BIGINT IDENTITY,
    
    -- 数据源标识
    source_system VARCHAR(50) NOT NULL,
    data_type VARCHAR(50) NOT NULL,        -- metrics, events, logs等
    
    -- 业务标识
    user_id INT,
    session_id VARCHAR(100),
    entity_id VARCHAR(100),
    
    -- 实时数据
    raw_data JSON NOT NULL,                -- 原始数据
    processed_data JSON,                   -- 预处理后数据
    
    -- 时间信息
    event_timestamp TIMESTAMP NOT NULL,    -- 业务时间
    ingestion_timestamp TIMESTAMP DEFAULT current_timestamp(), -- 摄入时间
    processing_timestamp TIMESTAMP,        -- 处理时间
    
    -- 数据质量
    data_quality_score DECIMAL(3,2),       -- 数据质量评分
    validation_errors ARRAY<STRING>,       -- 验证错误列表
    
    -- 实时分区（按小时）
    hour_partition STRING GENERATED ALWAYS AS (
        date_format(event_timestamp, 'yyyy-MM-dd-HH')
    )
) 
PARTITIONED BY (hour_partition)
HASH CLUSTERED BY (user_id)
SORTED BY (event_timestamp DESC)
INTO 1024 BUCKETS
COMMENT '实时数据流表 - Lambda架构速度层，处理流式数据';

-- 实时查询优化
CREATE BLOOMFILTER INDEX realtime_user_idx ON TABLE realtime_data_stream(user_id);
CREATE BLOOMFILTER INDEX realtime_source_idx ON TABLE realtime_data_stream(source_system);
CREATE INVERTED INDEX realtime_data_search_idx ON TABLE realtime_data_stream(raw_data) 
PROPERTIES ('analyzer' = 'unicode');

-- 批处理聚合层（Batch Layer）
CREATE TABLE batch_aggregated_analytics (
    agg_id BIGINT IDENTITY,
    
    -- 聚合维度
    user_id INT NOT NULL,
    data_type VARCHAR(50) NOT NULL,
    source_system VARCHAR(50) NOT NULL,
    
    -- 时间窗口
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    window_type VARCHAR(20) NOT NULL,      -- HOUR, DAY, WEEK, MONTH
    
    -- 聚合指标
    event_count INT,
    unique_sessions INT,
    total_duration BIGINT,                 -- 毫秒
    avg_quality_score DECIMAL(5,3),
    
    -- 统计指标
    min_value DOUBLE,
    max_value DOUBLE,
    avg_value DOUBLE,
    std_deviation DOUBLE,
    percentile_50 DOUBLE,
    percentile_95 DOUBLE,
    percentile_99 DOUBLE,
    
    -- 业务指标
    conversion_rate DECIMAL(5,4),
    error_rate DECIMAL(5,4),
    
    -- 批处理元信息
    batch_id VARCHAR(100),
    batch_timestamp TIMESTAMP DEFAULT current_timestamp(),
    processing_version VARCHAR(20) DEFAULT '2.2',
    
    date_partition STRING GENERATED ALWAYS AS (date_format(window_start, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (user_id, data_type)
SORTED BY (window_start DESC)
INTO 256 BUCKETS
COMMENT '批处理聚合表 - Lambda架构批处理层，提供准确的历史分析';

-- 服务层统一视图（Serving Layer）
CREATE TABLE serving_layer_unified_view (
    view_id BIGINT IDENTITY,
    
    -- 标识信息
    user_id INT NOT NULL,
    metric_name VARCHAR(100) NOT NULL,
    
    -- 实时数据（最近1小时）
    realtime_value DOUBLE,
    realtime_timestamp TIMESTAMP,
    realtime_confidence DECIMAL(3,2),
    
    -- 批处理数据（历史聚合）
    batch_value DOUBLE,
    batch_timestamp TIMESTAMP,
    batch_window_type VARCHAR(20),
    
    -- 统一结果（智能合并）
    unified_value DOUBLE,
    data_source VARCHAR(20),               -- realtime, batch, hybrid
    confidence_level DECIMAL(3,2),
    
    -- 更新信息
    last_updated TIMESTAMP DEFAULT current_timestamp(),
    
    date_partition STRING GENERATED ALWAYS AS (date_format(last_updated, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (user_id)
SORTED BY (last_updated DESC)
INTO 128 BUCKETS
COMMENT '服务层统一视图 - 合并实时和批处理结果，对外提供统一查询接口';

-- 设置不同层的数据生命周期
ALTER TABLE realtime_data_stream SET TBLPROPERTIES ('data_lifecycle' = '7');        -- 实时数据7天
ALTER TABLE batch_aggregated_analytics SET TBLPROPERTIES ('data_lifecycle' = '365'); -- 批处理数据1年  
ALTER TABLE serving_layer_unified_view SET TBLPROPERTIES ('data_lifecycle' = '90');  -- 服务层3个月
```

### 模式3：多租户SaaS数据架构（企业级）

**适用场景**: 企业SaaS平台、多租户应用、数据隔离要求严格的业务

```sql
-- 租户主数据表
CREATE TABLE saas_tenant_registry (
    tenant_id VARCHAR(50) NOT NULL,    -- 移除PRIMARY KEY以兼容HASH CLUSTERED BY
    tenant_name VARCHAR(200) NOT NULL,
    
    -- 租户基本信息
    subscription_plan VARCHAR(50) NOT NULL, -- free, basic, premium, enterprise
    tenant_status TINYINT DEFAULT 1,        -- 1=active, 0=suspended, 2=trial
    
    -- 配置信息
    data_region VARCHAR(20) DEFAULT 'default', -- 数据存储区域
    schema_version VARCHAR(10) DEFAULT '2.2',  -- 租户schema版本
    feature_flags JSON DEFAULT '{}',           -- 功能开关配置
    quota_settings JSON DEFAULT '{}',          -- 配额限制设置
    
    -- 租户元数据
    created_at TIMESTAMP DEFAULT current_timestamp(),
    updated_at TIMESTAMP,
    
    -- 联系信息
    admin_email VARCHAR(320),
    billing_contact JSON
) 
HASH CLUSTERED BY (tenant_id)
INTO 32 BUCKETS
COMMENT '租户注册表 - 管理所有租户的基本信息和配置';

-- 多租户业务数据表（核心表）
CREATE TABLE saas_multi_tenant_data (
    record_id BIGINT IDENTITY,
    tenant_id VARCHAR(50) NOT NULL,
    
    -- 业务实体信息
    entity_type VARCHAR(50) NOT NULL,       -- user, order, product, invoice等
    entity_id VARCHAR(100) NOT NULL,        -- 在租户内的实体ID
    entity_status TINYINT DEFAULT 1,        -- 实体状态
    
    -- 业务数据
    core_data JSON NOT NULL,                -- 核心业务数据
    extended_data JSON DEFAULT '{}',        -- 扩展数据
    custom_fields JSON DEFAULT '{}',        -- 租户自定义字段
    
    -- 数据分类和标签
    data_category VARCHAR(50),              -- 数据分类
    tags ARRAY<STRING>,                     -- 业务标签
    priority_level TINYINT DEFAULT 1,       -- 优先级：1=normal, 2=high, 3=critical
    
    -- 审计信息
    created_by VARCHAR(100),
    updated_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT current_timestamp(),
    updated_at TIMESTAMP,
    version_number INT DEFAULT 1,
    
    -- 数据治理
    data_classification VARCHAR(20) DEFAULT 'internal', -- public, internal, confidential, restricted
    retention_policy VARCHAR(50),           -- 数据保留策略
    
    -- 性能优化
    tenant_partition STRING GENERATED ALWAYS AS (tenant_id)
) 
PARTITIONED BY (tenant_partition)          -- 租户级数据隔离
HASH CLUSTERED BY (entity_id)             -- 实体维度分桶
SORTED BY (updated_at DESC, priority_level DESC) -- 最新和高优先级数据优先
INTO 256 BUCKETS
COMMENT '多租户业务数据表 - 实现租户级数据隔离和高效查询';

-- 多租户查询优化索引
CREATE BLOOMFILTER INDEX saas_entity_type_idx ON TABLE saas_multi_tenant_data(entity_type);
CREATE BLOOMFILTER INDEX saas_entity_id_idx ON TABLE saas_multi_tenant_data(entity_id);
CREATE INVERTED INDEX saas_tags_idx ON TABLE saas_multi_tenant_data(tags);
CREATE INVERTED INDEX saas_core_data_idx ON TABLE saas_multi_tenant_data(core_data) 
PROPERTIES ('analyzer' = 'unicode');

-- 租户使用统计表（计费和监控）
CREATE TABLE saas_tenant_usage_stats (
    usage_id BIGINT IDENTITY,
    tenant_id VARCHAR(50) NOT NULL,
    
    -- 统计时间窗口
    stat_date DATE NOT NULL,
    stat_hour TINYINT,                      -- 0-23，NULL表示日级统计
    
    -- 使用量统计
    api_calls_count INT DEFAULT 0,
    storage_bytes_used BIGINT DEFAULT 0,
    data_transfer_bytes BIGINT DEFAULT 0,
    compute_seconds_used INT DEFAULT 0,
    
    -- 功能使用统计
    active_users_count INT DEFAULT 0,
    unique_sessions_count INT DEFAULT 0,
    feature_usage_stats JSON DEFAULT '{}',
    
    -- 性能指标
    avg_response_time_ms INT,
    error_rate DECIMAL(5,4),
    availability_percentage DECIMAL(5,2),
    
    -- 成本分摊
    estimated_cost_usd DECIMAL(10,4),
    
    -- 更新信息
    last_updated TIMESTAMP DEFAULT current_timestamp(),
    
    date_partition STRING GENERATED ALWAYS AS (string(stat_date))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (tenant_id)
SORTED BY (stat_date DESC, stat_hour DESC)
INTO 64 BUCKETS
COMMENT '租户使用统计表 - 支持计费、监控和资源管理';

-- 设置数据生命周期策略
ALTER TABLE saas_multi_tenant_data SET TBLPROPERTIES ('data_lifecycle' = '1095');    -- 3年业务数据
ALTER TABLE saas_tenant_usage_stats SET TBLPROPERTIES ('data_lifecycle' = '730');    -- 2年统计数据
```

### 模式4：IoT时序数据架构（工业级）

**适用场景**: 工业IoT、智能制造、设备监控、传感器数据处理

```sql
-- 设备主数据表
CREATE TABLE iot_device_registry (
    device_id VARCHAR(100) NOT NULL,
    
    -- 设备基本信息
    device_name VARCHAR(200),
    device_type VARCHAR(50) NOT NULL,      -- sensor, actuator, gateway, edge
    device_model VARCHAR(100),
    manufacturer VARCHAR(100),
    firmware_version VARCHAR(50),
    
    -- 部署信息
    installation_location VARCHAR(200),
    geo_location JSON,                      -- {"lat": 39.9042, "lng": 116.4074}
    facility_id VARCHAR(50),
    production_line VARCHAR(50),
    
    -- 设备配置
    measurement_interval_seconds INT DEFAULT 60,
    data_retention_days INT DEFAULT 90,
    alert_thresholds JSON DEFAULT '{}',
    calibration_params JSON DEFAULT '{}',
    
    -- 设备状态
    device_status TINYINT DEFAULT 1,        -- 1=online, 0=offline, 2=maintenance
    last_heartbeat TIMESTAMP,
    health_score DECIMAL(3,2),              -- 0.00-1.00
    
    -- 管理信息
    created_at TIMESTAMP DEFAULT current_timestamp(),
    updated_at TIMESTAMP
) 
HASH CLUSTERED BY (device_type)
INTO 32 BUCKETS
COMMENT 'IoT设备注册表 - 管理所有IoT设备的元数据信息';

-- 高频时序数据表
CREATE TABLE iot_timeseries_measurements (
    measurement_id BIGINT IDENTITY,
    
    -- 设备和测量标识
    device_id VARCHAR(100) NOT NULL,
    sensor_id VARCHAR(100),                 -- 复合设备中的传感器ID
    measurement_type VARCHAR(50) NOT NULL,  -- temperature, pressure, vibration, current等
    
    -- 测量数据
    measurement_value DOUBLE,               -- 主要数值
    measurement_unit VARCHAR(20),           -- 单位：℃, Pa, Hz, A等
    secondary_values JSON,                  -- 辅助测量值（多维传感器）
    
    -- 时间信息（高精度）
    measurement_timestamp TIMESTAMP NOT NULL, -- 设备时间戳
    collection_timestamp TIMESTAMP DEFAULT current_timestamp(), -- 收集时间戳
    
    -- 数据质量和状态
    data_quality_code TINYINT DEFAULT 1,    -- 1=good, 2=uncertain, 3=bad
    measurement_status TINYINT DEFAULT 0,   -- 0=normal, 1=warning, 2=alarm, 3=fault
    confidence_level DECIMAL(3,2),          -- 测量置信度
    
    -- 异常检测结果
    is_anomaly BOOLEAN DEFAULT false,
    anomaly_score DECIMAL(5,3),            -- 异常评分
    anomaly_type VARCHAR(50),              -- 异常类型
    
    -- 上下文信息
    environment_context JSON,              -- 环境参数（温湿度、气压等）
    operational_context JSON,              -- 运行参数（负载、转速等）
    
    -- 高频数据按小时分区
    hour_partition STRING GENERATED ALWAYS AS (
        date_format(measurement_timestamp, 'yyyy-MM-dd-HH')
    )
) 
PARTITIONED BY (hour_partition)           -- 按小时分区支持时间范围查询
HASH CLUSTERED BY (device_id)            -- 按设备分桶
SORTED BY (measurement_timestamp DESC)   -- 时间倒序，最新数据优先
INTO 2048 BUCKETS                        -- 大量设备需要更多分桶
COMMENT 'IoT时序测量数据表 - 存储高频传感器数据和异常检测结果';

-- 时序数据查询优化索引
CREATE BLOOMFILTER INDEX iot_device_lookup_idx ON TABLE iot_timeseries_measurements(device_id);
CREATE BLOOMFILTER INDEX iot_measurement_type_idx ON TABLE iot_timeseries_measurements(measurement_type);
CREATE INVERTED INDEX iot_anomaly_filter_idx ON TABLE iot_timeseries_measurements(is_anomaly);
CREATE INVERTED INDEX iot_status_filter_idx ON TABLE iot_timeseries_measurements(measurement_status);

-- 设备状态聚合表（实时计算结果）
CREATE TABLE iot_device_status_aggregated (
    agg_id BIGINT IDENTITY,
    device_id VARCHAR(100) NOT NULL,
    
    -- 聚合时间窗口
    window_start TIMESTAMP NOT NULL,
    window_end TIMESTAMP NOT NULL,
    window_type VARCHAR(20) NOT NULL,      -- MINUTE, HOUR, DAY
    measurement_type VARCHAR(50) NOT NULL,
    
    -- 统计指标
    measurement_count INT,
    valid_measurement_count INT,           -- 质量良好的测量数
    
    -- 数值统计
    min_value DOUBLE,
    max_value DOUBLE,
    avg_value DOUBLE,
    median_value DOUBLE,
    std_deviation DOUBLE,
    
    -- 异常统计
    anomaly_count INT DEFAULT 0,
    alarm_count INT DEFAULT 0,
    fault_count INT DEFAULT 0,
    
    -- 设备健康指标
    uptime_percentage DECIMAL(5,2),
    data_quality_avg DECIMAL(3,2),
    health_trend TINYINT,                  -- 1=improving, 0=stable, -1=degrading
    
    -- 预测性维护指标
    maintenance_score DECIMAL(5,3),        -- 维护需求评分
    estimated_rul_hours INT,               -- 剩余使用寿命（小时）
    next_maintenance_date DATE,
    
    -- 计算元数据
    computed_timestamp TIMESTAMP DEFAULT current_timestamp(),
    computation_version VARCHAR(20) DEFAULT '2.2',
    model_version VARCHAR(20),             -- 预测模型版本
    
    date_partition STRING GENERATED ALWAYS AS (date_format(window_start, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (device_id)
SORTED BY (window_start DESC)
INTO 512 BUCKETS
COMMENT '设备状态聚合表 - 实时计算的设备健康状态和预测性维护指标';

-- 设备告警事件表
CREATE TABLE iot_device_alerts (
    alert_id BIGINT IDENTITY,
    
    -- 告警标识
    device_id VARCHAR(100) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,       -- threshold, anomaly, fault, offline
    alert_level TINYINT NOT NULL,          -- 1=info, 2=warning, 3=error, 4=critical
    
    -- 告警内容
    alert_title VARCHAR(200),
    alert_description STRING,
    alert_data JSON,                       -- 告警相关数据
    
    -- 告警状态
    alert_status TINYINT DEFAULT 1,        -- 1=active, 2=acknowledged, 3=resolved
    acknowledged_by VARCHAR(100),
    resolved_by VARCHAR(100),
    
    -- 时间信息
    alert_timestamp TIMESTAMP NOT NULL,
    acknowledged_at TIMESTAMP,
    resolved_at TIMESTAMP,
    
    -- 业务影响
    business_impact VARCHAR(100),          -- 业务影响描述
    estimated_downtime_minutes INT,        -- 预估停机时间
    
    date_partition STRING GENERATED ALWAYS AS (date_format(alert_timestamp, 'yyyy-MM-dd'))
) 
PARTITIONED BY (date_partition)
HASH CLUSTERED BY (device_id)
SORTED BY (alert_timestamp DESC, alert_level DESC)
INTO 128 BUCKETS
COMMENT '设备告警事件表 - 记录和管理所有设备告警信息';

-- 设置分层数据生命周期
ALTER TABLE iot_timeseries_measurements SET TBLPROPERTIES ('data_lifecycle' = '90');     -- 原始数据3个月
ALTER TABLE iot_device_status_aggregated SET TBLPROPERTIES ('data_lifecycle' = '730');   -- 聚合数据2年
ALTER TABLE iot_device_alerts SET TBLPROPERTIES ('data_lifecycle' = '1095');             -- 告警记录3年
```

## 🧹 实验环境清理指南

为确保资源合理使用和避免不必要的存储开销，在完成表设计实验后应当执行以下清理操作：

### 表资源清理

```sql
-- 1. 清理测试表
DROP TABLE IF EXISTS test_identity_table;
DROP TABLE IF EXISTS test_identity_seed_table;
DROP TABLE IF EXISTS test_string_types;
DROP TABLE IF EXISTS test_vector_table;
DROP TABLE IF EXISTS test_complex_types;
DROP TABLE IF EXISTS test_constraints;
DROP TABLE IF EXISTS test_generated_columns;

-- 2. 清理分区测试表
DROP TABLE IF EXISTS test_partition_daily;
DROP TABLE IF EXISTS test_partition_hourly;
DROP TABLE IF EXISTS test_partition_tenant;
DROP TABLE IF EXISTS test_partition_multi;
DROP TABLE IF EXISTS partition_type_solutions;

-- 3. 清理索引测试表
DROP TABLE IF EXISTS test_vector_index_table;
DROP TABLE IF EXISTS test_inverted_index_table;
DROP TABLE IF EXISTS test_bloom_index_table;
DROP TABLE IF EXISTS comprehensive_vector_demo;
DROP TABLE IF EXISTS comprehensive_search_demo;
DROP TABLE IF EXISTS user_management_optimized;
DROP TABLE IF EXISTS product_catalog;
DROP TABLE IF EXISTS user_content;

-- 4. 清理优化测试表
DROP TABLE IF EXISTS user_behavior_optimized;
DROP TABLE IF EXISTS financial_transactions_optimized;
DROP TABLE IF EXISTS business_analytics_optimized;
DROP TABLE IF EXISTS vector_search_performance;
DROP TABLE IF EXISTS storage_cost_optimized;
DROP TABLE IF EXISTS small_table_optimized;
DROP TABLE IF EXISTS medium_table_optimized;
DROP TABLE IF EXISTS large_table_optimized;

-- 5. 清理企业级架构模式表
-- 事件溯源架构
DROP TABLE IF EXISTS event_store_transactions;
DROP TABLE IF EXISTS aggregate_snapshots;

-- 实时数据湖架构
DROP TABLE IF EXISTS realtime_data_stream;
DROP TABLE IF EXISTS batch_aggregated_analytics;
DROP TABLE IF EXISTS serving_layer_unified_view;

-- 多租户SaaS架构
DROP TABLE IF EXISTS saas_tenant_registry;
DROP TABLE IF EXISTS saas_multi_tenant_data;
DROP TABLE IF EXISTS saas_tenant_usage_stats;

-- IoT时序数据架构
DROP TABLE IF EXISTS iot_device_registry;
DROP TABLE IF EXISTS iot_timeseries_measurements;
DROP TABLE IF EXISTS iot_device_status_aggregated;
DROP TABLE IF EXISTS iot_device_alerts;
```

***

## 📋 总结

### 验证成果

本指南经过云器Lakehouse环境完整验证，所有关键功能点均已确认可用：

#### ✅ 已验证功能

* **数据类型**: IDENTITY(仅BIGINT)、向量类型、复杂类型（STRUCT/ARRAY/MAP）
* **约束和生成列**: 确定性函数列表、默认值语法
* **分区策略**: 支持的分区类型、生成列分区转换
* **分桶排序**: 分桶数量配置、排序策略优化
* **索引架构**: 向量索引5种距离函数、倒排索引分词器、布隆过滤器
* **性能优化**: 查询剪枝、多维度索引协同
* **企业架构**: 四种设计模式的完整实现

#### 🔧 重要发现和修正

1. **索引命名**: 当前版本强制schema级唯一性，遵循唯一命名
2. **向量维度**: 插入时必须严格匹配定义的维度
3. **ARRAY索引**: 不支持指定analyzer参数
4. **PRIMARY KEY冲突**: 与HASH CLUSTERED BY同时使用需满足严格条件

### 核心价值

本指南的核心价值在于：

1. **实用性**: 所有示例均经实际验证，可直接应用于生产环境
2. **完整性**: 覆盖从基础类型到企业架构的全栈设计指导
3. **前瞻性**: 基于最新产品功能特性，适应技术发展趋势
4. **可维护性**: 提供完整的故障排查和设计评审体系

### 使用建议

1. **新项目**: 按照设计理念章节建立设计框架，参考企业级模式选择合适架构
2. **现有系统**: 使用设计评审检查清单进行系统优化和问题排查
3. **团队培训**: 结合实际业务场景，逐章节学习和实践
4. **持续优化**: 根据业务发展和数据增长，定期评估和调整设计策略

**最佳实践建议**: 严格遵循本指南的设计原则和验证过的SQL语法，将显著提升系统性能、降低运维复杂度，并为业务增长提供可靠的数据基础设施保障。

## 参考资料

[Create Table语法](create-table-ddl.md)

***

*注：本指南基于2025年5月的云器Lakehouse版本测试结果，后续版本可能有所变化。请定期检查官方文档以获取最新信息*。

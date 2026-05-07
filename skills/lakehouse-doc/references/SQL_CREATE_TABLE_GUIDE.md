# Lakehouse CREATE TABLE使用指南

## 概述

云器Lakehouse提供了功能完整、性能卓越的建表能力，完美支持从Spark、Hive、MaxCompute、Snowflake、Databricks和传统数据库的平滑迁移。本指南基于官方文档和生产环境验证，为不同技术背景的用户提供专业的迁移路径和最佳实践。

### 🎯 **快速导航**

* [Spark用户迁移指南](#spark用户迁移指南) - DataFrame到SQL DDL的无缝转换
* [Hive用户迁移指南](#hive用户迁移指南) - 分区语法的完美兼容与性能提升
* [MaxCompute用户迁移指南](#maxcompute用户迁移指南) - 阿里云生态的自然延伸
* [Snowflake用户迁移指南](#snowflake用户迁移指南) - 云原生架构的进阶优化
* [Databricks用户迁移指南](#databricks用户迁移指南) - Delta Lake理念的深度融合
* [传统数据库用户迁移指南](#传统数据库用户迁移指南) - OLTP到OLAP的华丽转身

***

## CREATE TABLE完整语法

### 语法结构

```sql
CREATE TABLE [ IF NOT EXISTS ] table_name 
(
    column_definition [, column_definition, ...]
    [, index_definition_list]
)
[ PARTITIONED BY (partition_spec) ]
[ CLUSTERED BY (column_list) [SORTED BY (column_list)] INTO num_buckets BUCKETS ]
[ COMMENT 'table_comment' ]
[ PROPERTIES ('key' = 'value', ...) ];
```

### 列定义语法

```sql
column_name column_type 
[ NOT NULL ]
[ PRIMARY KEY ]
[ IDENTITY[(seed)] ]
[ GENERATED ALWAYS AS (expr) ]
[ DEFAULT default_expression ]
[ COMMENT 'column_comment' ]
```

### 支持的数据类型

| 类别        | 数据类型                    | 说明               | 对应其他系统                    |
| --------- | ----------------------- | ---------------- | ------------------------- |
| **数值类型**  | TINYINT                 | 1字节整数(-128到127)  | Spark/Hive: TINYINT       |
|           | SMALLINT                | 2字节整数            | Spark/Hive: SMALLINT      |
|           | INT                     | 4字节整数            | Spark/Hive: INT/INTEGER   |
|           | BIGINT                  | 8字节整数            | Spark/Hive: BIGINT/LONG   |
|           | FLOAT                   | 4字节浮点数           | Spark/Hive: FLOAT         |
|           | DOUBLE                  | 8字节浮点数           | Spark/Hive: DOUBLE        |
|           | DECIMAL(p,s)            | 精确数值             | Spark/Hive: DECIMAL       |
| **字符类型**  | VARCHAR(n)              | 变长字符串(最大1048576) | Snowflake: VARCHAR        |
|           | CHAR(n)                 | 定长字符串(1-255)     | Oracle: CHAR              |
|           | STRING                  | 默认16MB，可调整       | Hive/Spark: STRING        |
| **时间类型**  | DATE                    | 日期(YYYY-MM-DD)   | 所有系统通用                    |
|           | TIMESTAMP               | 时间戳(本地时间)        | Spark: TIMESTAMP          |
|           | TIMESTAMP\_NTZ          | 无时区时间戳           | Snowflake: TIMESTAMP\_NTZ |
| **二进制类型** | BINARY                  | 二进制数据，默认16MB     | Hive: BINARY              |
| **布尔类型**  | BOOLEAN                 | 真/假              | 所有系统通用                    |
| **复杂类型**  | ARRAY                   | 数组               | Spark/Hive: ARRAY         |
|           | MAP\<K,V>               | 键值对              | Spark/Hive: MAP           |
|           | STRUCT<...>             | 结构体              | Spark/Hive: STRUCT        |
|           | JSON                    | JSON数据，默认16MB    | Snowflake: VARIANT        |
| **向量类型**  | VECTOR(dimension)       | 向量类型             | 用于向量搜索场景                  |
|           | VECTOR(type, dimension) | 指定元素类型的向量        | type: tinyint/int/float   |

***

## Spark用户迁移指南

### 核心优势对比

| 特性           | Spark           | Lakehouse  | 优势      |
| ------------ | --------------- | ---------- | ------- |
| **建表方式**     | DataFrame API为主 | SQL DDL标准化 | 降低学习成本  |
| **分区管理**     | 手动管理            | 隐藏分区+转换分区  | 自动优化    |
| **数据组织**     | 文件级别            | 表级别管理      | 更高效的元数据 |
| **Schema演进** | 需要重写            | 原地演进       | 灵活性更强   |

### DataFrame到DDL的转换

**Spark DataFrame方式**：

```python
# Spark DataFrame创建表
df = spark.read.parquet("path/to/data")
df.write.partitionBy("year", "month") \
  .bucketBy(10, "user_id") \
  .sortBy("timestamp") \
  .saveAsTable("user_events")
```

**Lakehouse DDL方式**：

```sql
-- 对应的Lakehouse建表语句
CREATE TABLE user_events (
    user_id BIGINT,
    event_type STRING,
    timestamp TIMESTAMP,
    properties MAP<STRING, STRING>,
    year INT GENERATED ALWAYS AS (year(timestamp)),
    month INT GENERATED ALWAYS AS (month(timestamp))
) 
PARTITIONED BY (year, month)
CLUSTERED BY (user_id) SORTED BY (timestamp) INTO 10 BUCKETS
COMMENT '用户事件表';
```

### 高级特性映射

**1. 动态分区处理**

```sql
-- Spark需要手动处理动态分区
-- Lakehouse使用转换分区自动处理
CREATE TABLE events (
    event_time TIMESTAMP,
    user_id STRING,
    event_data STRING
) PARTITIONED BY (
    days(event_time),        -- 自动按天分区
    bucket(100, user_id)     -- 自动按用户ID分桶
);
```

**2. Schema合并与演进**

```sql
-- Lakehouse原生支持Schema演进
ALTER TABLE events ADD COLUMN new_field STRING;
ALTER TABLE events CHANGE COLUMN event_data TYPE JSON;
```

**3. 复杂数据类型处理**

```sql
-- 完全兼容Spark的复杂类型
CREATE TABLE user_profiles (
    user_id BIGINT,
    tags ARRAY<STRING>,                          -- 标签数组
    attributes MAP<STRING, STRING>,              -- 属性映射
    address STRUCT<                              -- 嵌套结构
        street: STRING,
        city: STRING,
        coordinates: STRUCT<lat: DOUBLE, lon: DOUBLE>
    >,
    preferences JSON                             -- JSON灵活字段
);
```

### 性能优化建议

```sql
-- 针对Spark用户的优化建表模式
CREATE TABLE optimized_fact_table (
    -- 业务字段
    transaction_id BIGINT IDENTITY(1),
    user_id BIGINT,
    product_id INT,
    amount DECIMAL(18, 2),
    transaction_time TIMESTAMP,
    
    -- 生成分区字段（替代Spark的手动分区）
    tx_date STRING GENERATED ALWAYS AS (date_format(transaction_time, 'yyyy-MM-dd')),
    tx_hour INT GENERATED ALWAYS AS (hour(transaction_time))
) 
PARTITIONED BY (tx_date, tx_hour)              -- 双层分区
CLUSTERED BY (user_id) INTO 256 BUCKETS        -- 用户维度分桶
PROPERTIES (
    'data_lifecycle' = '730',                   -- 2年生命周期
    'partition.cache.policy.latest.count' = '7' -- 缓存最近7天
);
```

***

## Hive用户迁移指南

### 完美的语法兼容性

云器Lakehouse完全兼容Hive的分区语法，同时提供了更强大的功能：

**传统Hive建表**：

```sql
-- Hive风格（完全支持）
CREATE TABLE IF NOT EXISTS sales_fact (
    order_id BIGINT,
    product_id INT,
    quantity INT,
    price DECIMAL(10,2)
) PARTITIONED BY (
    dt STRING,
    region STRING
)
STORED AS PARQUET
TBLPROPERTIES ('transactional'='true');
```

**Lakehouse增强版**：

```sql
-- 相同语法，更强性能
CREATE TABLE IF NOT EXISTS sales_fact (
    order_id BIGINT,
    product_id INT,
    quantity INT,
    price DECIMAL(10,2),
    order_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP  -- 新增：默认值
) PARTITIONED BY (
    dt STRING,
    region STRING
)
COMMENT 'Sales fact table with enhanced features'
PROPERTIES (
    'data_lifecycle' = '1095',      -- 新增：3年生命周期管理
    'change_tracking' = 'false'     -- 新增：CDC能力预留
);
```

### 分区策略升级

**静态分区到智能分区的进化**：

```sql
-- Hive传统方式：需要手动管理分区
INSERT OVERWRITE TABLE sales_fact PARTITION(dt='2024-06-20', region='CN')
SELECT ...;

-- Lakehouse智能方式：自动分区管理
CREATE TABLE sales_fact_smart (
    order_id BIGINT,
    order_time TIMESTAMP,
    region_code STRING,
    amount DECIMAL(10,2),
    -- 自动生成分区字段
    dt STRING GENERATED ALWAYS AS (date_format(order_time, 'yyyy-MM-dd'))
) PARTITIONED BY (dt, region_code);

-- 插入时自动处理分区
INSERT INTO sales_fact_smart (order_id, order_time, region_code, amount)
VALUES (1001, CURRENT_TIMESTAMP, 'CN', 99.99);
```

### 事务表能力增强

```sql
-- Hive事务表限制多，Lakehouse原生支持
CREATE TABLE transaction_table (
    id BIGINT PRIMARY KEY,           -- 原生主键支持
    data STRING,
    version INT,
    updated_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) 
CLUSTERED BY (id) INTO 16 BUCKETS   -- 必需的分桶优化
PROPERTIES (
    'data_retention_days' = '7'      -- Time Travel能力
);
```

### 性能提升对比

| 操作类型     | Hive (MapReduce) | Lakehouse | 性能提升 |
| -------- | ---------------- | --------- | ---- |
| 建表速度     | 秒级               | 毫秒级       | 10x  |
| 分区裁剪     | 文件级扫描            | 元数据裁剪     | 100x |
| Schema变更 | 需重建              | 在线变更      | ∞    |
| 小文件合并    | 手动维护             | 自动优化      | 自动化  |

***

## MaxCompute用户迁移指南

### 语法对照与增强

MaxCompute用户会发现云器Lakehouse的语法非常熟悉，同时功能更加强大：

**MaxCompute建表**：

```sql
-- MaxCompute语法
CREATE TABLE IF NOT EXISTS sale_detail(
    shop_name STRING,
    customer_id STRING,
    total_price DOUBLE
)
PARTITIONED BY (sale_date STRING, region STRING)
LIFECYCLE 730;
```

**Lakehouse对应语法**：

```sql
-- 几乎相同的语法，更多功能
CREATE TABLE IF NOT EXISTS sale_detail(
    shop_name STRING,
    customer_id STRING,
    total_price DOUBLE,
    -- 新增能力
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    row_id BIGINT IDENTITY(1)  -- 自增主键
)
PARTITIONED BY (sale_date STRING, region STRING)
PROPERTIES (
    'data_lifecycle' = '730',  -- 生命周期（天）
    'data_retention_days' = '7' -- Time Travel保留期
);
```

### 函数兼容性

```sql
-- MaxCompute函数 → Lakehouse函数映射
CREATE TABLE datetime_example (
    id INT,
    -- MaxCompute: GETDATE() → Lakehouse: CURRENT_TIMESTAMP
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 日期函数完全兼容
    year_part INT GENERATED ALWAYS AS (YEAR(created_at)),
    month_part INT GENERATED ALWAYS AS (MONTH(created_at)),
    
    -- 字符串函数相同
    user_name STRING,
    name_length INT GENERATED ALWAYS AS (LENGTH(user_name))
);
```

### 资源管理对比

| 特性   | MaxCompute | Lakehouse  | 优势   |
| ---- | ---------- | ---------- | ---- |
| 计算资源 | 预付费CU      | 弹性VCLUSTER | 按需付费 |
| 存储限制 | 项目配额       | 无限扩展       | 更灵活  |
| 并发控制 | 作业队列       | 动态调度       | 更高效  |
| 跨地域  | 需要迁移       | 原生支持       | 全球化  |

***

## Snowflake用户迁移指南

### 架构理念对比

两者都是云原生数据仓库，但Lakehouse提供了更多的控制权：

**Snowflake风格建表**：

```sql
-- Snowflake
CREATE OR REPLACE TABLE customer_transactions (
    transaction_id NUMBER AUTOINCREMENT,
    customer_id VARCHAR,
    amount NUMBER(18,2),
    transaction_date TIMESTAMP_NTZ,
    status VARCHAR DEFAULT 'PENDING'
) CLUSTER BY (customer_id);
```

**Lakehouse增强版**：

```sql
-- Lakehouse：更明确的优化控制
CREATE TABLE IF NOT EXISTS customer_transactions (
    transaction_id BIGINT IDENTITY(1),  -- 对应AUTOINCREMENT
    customer_id VARCHAR(100),
    amount DECIMAL(18,2),
    transaction_date TIMESTAMP_NTZ,
    status VARCHAR(20) DEFAULT 'PENDING',
    
    -- 额外优化字段
    tx_date STRING GENERATED ALWAYS AS (date_format(transaction_date, 'yyyy-MM-dd')),
    INDEX idx_customer (customer_id) BLOOMFILTER  -- 显式索引
) 
PARTITIONED BY (tx_date)  -- 显式分区策略
CLUSTERED BY (customer_id) INTO 128 BUCKETS  -- 明确分桶数
COMMENT 'Customer transaction table with explicit optimizations';
```

### 时间旅行与克隆

```sql
-- Snowflake Time Travel → Lakehouse Time Travel
CREATE TABLE orders_backup AS
SELECT * FROM orders;  -- 立即复制

-- Lakehouse还支持：
ALTER TABLE orders SET PROPERTIES ('data_retention_days' = '30');  -- 30天历史
-- 查询历史数据
SELECT * FROM orders TIMESTAMP AS OF '2024-06-01 00:00:00';
```

### 性能调优差异

```sql
-- Snowflake：自动优化
-- Lakehouse：提供更多调优选项

CREATE TABLE large_fact_table (
    -- 列定义
    fact_id BIGINT,
    dim1_id INT,
    dim2_id INT,
    measure1 DECIMAL(18,4),
    measure2 DECIMAL(18,4),
    fact_time TIMESTAMP,
    
    -- 性能优化
    fact_date STRING GENERATED ALWAYS AS (date_format(fact_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (fact_date)
CLUSTERED BY (dim1_id, dim2_id) 
    SORTED BY (fact_time DESC)    -- 额外的排序优化
    INTO 256 BUCKETS              -- 精确控制并行度
PROPERTIES (
    'partition.cache.policy.latest.count' = '30'  -- 缓存策略
);
```

***

## Databricks用户迁移指南

### Delta Lake理念的深度融合

Lakehouse借鉴了Delta Lake的设计理念，提供类似但更简洁的语法：

**Databricks Delta表**：

```python
# Databricks Python API
(spark.sql("""
    CREATE TABLE IF NOT EXISTS events (
        event_id LONG,
        event_time TIMESTAMP,
        user_id STRING,
        event_type STRING,
        properties MAP<STRING, STRING>
    ) USING DELTA
    PARTITIONED BY (date(event_time))
    TBLPROPERTIES (
        'delta.deletedFileRetentionDuration' = '7 days',
        'delta.optimizeWrite' = 'true'
    )
"""))
```

**Lakehouse原生SQL**：

```sql
-- 纯SQL实现，无需Python包装
CREATE TABLE IF NOT EXISTS events (
    event_id BIGINT,
    event_time TIMESTAMP,
    user_id STRING,
    event_type STRING,
    properties MAP<STRING, STRING>,
    -- 自动分区字段
    event_date DATE GENERATED ALWAYS AS (CAST(event_time AS DATE))
) 
PARTITIONED BY (event_date)
PROPERTIES (
    'data_retention_days' = '7',      -- 对应deletedFileRetentionDuration
    'data_lifecycle' = '365'          -- 数据生命周期管理
);
```

### 流批一体架构

```sql
-- 支持实时写入的表设计
CREATE TABLE streaming_events (
    event_id BIGINT PRIMARY KEY,      -- 支持实时去重
    event_data JSON,
    received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    
    -- 分区设计支持流式写入
    event_hour INT GENERATED ALWAYS AS (hour(received_at)),
    event_date STRING GENERATED ALWAYS AS (date_format(received_at, 'yyyy-MM-dd'))
) 
PARTITIONED BY (event_date, event_hour)
CLUSTERED BY (event_id) INTO 32 BUCKETS
PROPERTIES (
    'change_tracking' = 'false'  -- 为Table Stream预留
);
```

### Z-Order优化对应

```sql
-- Databricks: OPTIMIZE table ZORDER BY (col1, col2)
-- Lakehouse: 通过CLUSTERED BY + SORTED BY实现类似效果

CREATE TABLE optimized_table (
    col1 INT,
    col2 STRING,
    col3 DECIMAL(10,2),
    col4 TIMESTAMP
)
CLUSTERED BY (col1, col2)      -- 数据聚集
SORTED BY (col1, col2)          -- 排序优化
INTO 64 BUCKETS;
```

***

## 传统数据库用户迁移指南

### 思维模式转变

从OLTP到OLAP的转变需要调整表设计思路：

**传统OLTP设计**：

```sql
-- MySQL/PostgreSQL/Oracle风格
CREATE TABLE orders (
    order_id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    order_date DATETIME DEFAULT NOW(),
    status VARCHAR(20) DEFAULT 'NEW',
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    INDEX idx_date (order_date),
    INDEX idx_customer (customer_id)
);
```

**Lakehouse OLAP设计**：

```sql
-- 面向分析优化的设计
CREATE TABLE orders (
    order_id BIGINT IDENTITY(1),     -- 自增主键
    customer_id INT NOT NULL,
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'NEW',
    
    -- 分析优化字段
    order_year INT GENERATED ALWAYS AS (year(order_date)),
    order_month INT GENERATED ALWAYS AS (month(order_date)),
    order_day INT GENERATED ALWAYS AS (day(order_date)),
    
    -- 索引定义
    INDEX bloom_customer (customer_id) BLOOMFILTER,
    INDEX bloom_status (status) BLOOMFILTER
) 
PARTITIONED BY (order_year, order_month)  -- 按月分区
CLUSTERED BY (customer_id) INTO 256 BUCKETS  -- 客户维度优化
PROPERTIES (
    'data_lifecycle' = '2555'  -- 7年数据保留
);
```

### 数据类型映射

| 传统数据库               | Lakehouse          | 迁移建议         |
| ------------------- | ------------------ | ------------ |
| INT AUTO\_INCREMENT | BIGINT IDENTITY(1) | 使用BIGINT避免溢出 |
| DATETIME            | TIMESTAMP          | 统一时间类型       |
| TEXT                | STRING             | 默认16MB，可调整   |
| ENUM                | VARCHAR + CHECK    | 使用约束替代       |
| JSON (MySQL)        | JSON               | 原生JSON支持     |
| SERIAL (PG)         | BIGINT IDENTITY(1) | 完全兼容         |

### 索引策略转换

```sql
-- 传统B-Tree索引 → 列式存储优化
CREATE TABLE user_activity (
    user_id BIGINT,
    activity_time TIMESTAMP,
    activity_type VARCHAR(50),
    details JSON,
    
    -- 布隆过滤器替代B-Tree（点查询）
    INDEX bloom_user (user_id) BLOOMFILTER,
    
    -- 倒排索引替代全文索引
    INDEX inv_details (details) INVERTED PROPERTIES ('analyzer' = 'english'),
    
    -- 生成列优化时间查询
    activity_date STRING GENERATED ALWAYS AS (date_format(activity_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (activity_date)  -- 时间分区加速范围查询
CLUSTERED BY (user_id) INTO 128 BUCKETS;  -- 用户维度聚集
```

***

## 高级特性详解

### 1. 自增列（IDENTITY）

```sql
-- 完整示例：订单表with自增主键
CREATE TABLE order_master (
    order_id BIGINT IDENTITY(1000),  -- 从1000开始
    order_no VARCHAR(50) NOT NULL,
    customer_id BIGINT NOT NULL,
    total_amount DECIMAL(18,2),
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) COMMENT '订单主表';

-- 注意事项：
-- 1. 仅支持BIGINT类型
-- 2. 不保证连续性（高并发下可能跳号）
-- 3. 不支持ALTER TABLE添加
```

**2. 生成列（GENERATED ALWAYS AS）**

```sql
-- 时间维度自动生成
CREATE TABLE sales_detail (
    sale_time TIMESTAMP,
    product_id INT,
    quantity INT,
    unit_price DECIMAL(10,2),
    
    -- 自动计算字段
    total_amount DECIMAL(18,2) GENERATED ALWAYS AS (quantity * unit_price),
    
    -- 时间维度展开
    sale_date STRING GENERATED ALWAYS AS (date_format(sale_time, 'yyyy-MM-dd')),
    sale_year INT GENERATED ALWAYS AS (year(sale_time)),
    sale_month INT GENERATED ALWAYS AS (month(sale_time)),
    sale_week INT GENERATED ALWAYS AS (weekofyear(sale_time)),
    sale_hour INT GENERATED ALWAYS AS (hour(sale_time))
) 
PARTITIONED BY (sale_date)  -- 可以用生成列作为分区
COMMENT '销售明细表with自动计算字段';
```

**生成列使用限制**：

* 生成列不能用于 `CLUSTERED BY` 或 `SORTED BY`
* 主键表不能使用生成列作为分区键
* 只支持确定性函数，不支持 `CURRENT_DATE`、`RANDOM` 等非确定性函数

### 3. 默认值（DEFAULT）

```sql
-- 审计表设计
CREATE TABLE audit_log (
    log_id BIGINT IDENTITY(1),
    table_name VARCHAR(100) NOT NULL,
    operation VARCHAR(20) NOT NULL,
    user_id VARCHAR(50) DEFAULT CURRENT_USER(),  -- 当前用户
    operation_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- 当前时间
    client_ip VARCHAR(50) DEFAULT '0.0.0.0',
    status VARCHAR(20) DEFAULT 'SUCCESS',
    details JSON
) 
PARTITIONED BY (date_format(operation_time, 'yyyy-MM-dd'))
COMMENT '统一审计日志表';
```

### 4. 主键与唯一约束

```sql
-- CDC场景的主键表设计
CREATE TABLE customer_snapshot (
    customer_id BIGINT,
    snapshot_date DATE,
    customer_name VARCHAR(200),
    customer_level VARCHAR(20),
    total_purchase DECIMAL(18,2),
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 复合主键
    PRIMARY KEY (customer_id, snapshot_date)
) 
PARTITIONED BY (snapshot_date)
CLUSTERED BY (customer_id, snapshot_date) 
SORTED BY (customer_id, snapshot_date) INTO 64 BUCKETS  -- 注意：主键表必须使用ASC排序
COMMENT '客户快照表for CDC';
```

**主键表的重要限制**：

* 主键列必须包含在 `CLUSTERED BY` 和 `SORTED BY` 中
* `SORTED BY` 必须使用升序（ASC），不能使用降序（DESC）
* 分区列必须是主键的子集
* 如果使用生成列，不能将其作为主键表的分区列

### 5. 复杂索引策略

```sql
-- 多维度查询优化表
CREATE TABLE product_search (
    product_id BIGINT PRIMARY KEY,
    product_name VARCHAR(500),
    description STRING,
    category_path VARCHAR(200),
    brand VARCHAR(100),
    price DECIMAL(10,2),
    tags ARRAY<STRING>,
    attributes MAP<STRING, STRING>,
    
    -- 多种索引组合（注意：索引名必须全局唯一）
    INDEX bloom_prod_brand (brand) BLOOMFILTER,  -- 品牌快速过滤
    INDEX bloom_prod_category (category_path) BLOOMFILTER,  -- 类目过滤
    INDEX inv_prod_name (product_name) INVERTED PROPERTIES ('analyzer' = 'chinese'),  -- 商品名搜索
    INDEX inv_prod_desc (description) INVERTED PROPERTIES ('analyzer' = 'chinese')  -- 描述搜索
)
CLUSTERED BY (product_id) SORTED BY (product_id) INTO 128 BUCKETS  -- 主键表限制
COMMENT '商品搜索优化表';
```

**索引命名最佳实践**：

* 索引名必须在整个数据库中唯一
* 建议使用 `表名_列名` 或 `idx_表名_列名` 格式
* 避免使用过于通用的名称如 `idx_id`

### 6. 向量索引（VECTOR）

```sql
-- 向量搜索场景表设计
CREATE TABLE embeddings_search (
    doc_id BIGINT PRIMARY KEY,
    content STRING,
    embedding VECTOR(512),  -- 512维向量，默认float类型
    vec_small VECTOR(128),  -- 128维向量
    vec_int VECTOR(int, 256),  -- 指定int类型的256维向量
    
    -- 向量索引
    INDEX vec_idx (embedding) USING VECTOR PROPERTIES (
        'scalar.type' = 'f32',
        'distance.function' = 'cosine_distance',  -- 余弦距离
        'm' = '16',  -- HNSW算法参数
        'ef.construction' = '200'
    )
)
CLUSTERED BY (doc_id) SORTED BY (doc_id) INTO 64 BUCKETS
COMMENT '向量搜索优化表';
```

**向量类型使用限制**：

* 不支持在ORDER BY或GROUP BY中使用
* 支持的元素类型：tinyint、int、float（默认）
* 可与数组类型相互转换

***

## 分区策略最佳实践

### 1. 时间分区设计

```sql
-- 多粒度时间分区
CREATE TABLE event_log (
    event_id BIGINT,
    event_time TIMESTAMP,
    event_type VARCHAR(50),
    event_data JSON,
    
    -- 多层分区字段生成
    event_date STRING GENERATED ALWAYS AS (date_format(event_time, 'yyyy-MM-dd')),
    event_hour INT GENERATED ALWAYS AS (hour(event_time))
) 
PARTITIONED BY (event_date, event_hour)  -- 双层分区
COMMENT '事件日志表with小时级分区';

-- 转换分区函数示例
CREATE TABLE metric_data (
    metric_time TIMESTAMP,
    metric_name VARCHAR(100),
    metric_value DOUBLE
) 
PARTITIONED BY (
    days(metric_time)  -- 按天数分区（从1970-01-01开始）
);
```

### 2. 业务维度分区

```sql
-- 多维度组合分区
CREATE TABLE transaction_fact (
    tx_id BIGINT IDENTITY(1),
    tx_time TIMESTAMP,
    region_code VARCHAR(10),
    channel_code VARCHAR(10),
    amount DECIMAL(18,2),
    
    tx_date STRING GENERATED ALWAYS AS (date_format(tx_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (tx_date, region_code, channel_code)  -- 三维分区
CLUSTERED BY (tx_id) INTO 256 BUCKETS
COMMENT '交易事实表with多维分区';
```

### 3. 分区数量控制

```sql
-- 合理控制分区粒度
CREATE TABLE log_archive (
    log_time TIMESTAMP,
    log_level VARCHAR(10),
    log_content STRING,
    
    -- 按月分区，避免过多分区
    log_month STRING GENERATED ALWAYS AS (date_format(log_time, 'yyyy-MM'))
) 
PARTITIONED BY (log_month)
PROPERTIES (
    'data_lifecycle' = '1095'  -- 3年后自动清理
);
```

***

## 分桶优化指南

### 1. 分桶数量选择

```sql
-- 分桶数量计算公式：总数据量 / 128MB~1GB

-- 小表（<10GB）：少量分桶
CREATE TABLE small_dim (
    dim_id INT,
    dim_name VARCHAR(100)
) CLUSTERED BY (dim_id) INTO 8 BUCKETS;

-- 中表（10GB~1TB）：适度分桶
CREATE TABLE medium_fact (
    fact_id BIGINT,
    measure DECIMAL(18,4)
) CLUSTERED BY (fact_id) INTO 128 BUCKETS;

-- 大表（>1TB）：大量分桶
CREATE TABLE large_fact (
    id BIGINT,
    data STRING
) CLUSTERED BY (id) INTO 1024 BUCKETS;
```

### 2. 分桶键选择策略

```sql
-- JOIN优化：使用JOIN键作为分桶键
CREATE TABLE order_items (
    order_id BIGINT,
    item_id INT,
    quantity INT,
    price DECIMAL(10,2)
) CLUSTERED BY (order_id) INTO 256 BUCKETS;  -- 与orders表相同分桶

CREATE TABLE orders (
    order_id BIGINT,
    customer_id INT,
    order_date DATE
) CLUSTERED BY (order_id) INTO 256 BUCKETS;  -- 相同分桶策略
```

### 3. 排序优化

```sql
-- SORTED BY加速范围查询
CREATE TABLE time_series_data (
    device_id VARCHAR(50),
    metric_time TIMESTAMP,
    metric_value DOUBLE
) 
CLUSTERED BY (device_id) 
SORTED BY (metric_time DESC)  -- 最新数据优先
INTO 128 BUCKETS;
```

***

## 表属性（PROPERTIES）深度解析

### 官方支持的属性

```sql
CREATE TABLE data_management (
    id BIGINT,
    data STRING,
    create_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) 
PROPERTIES (
    -- 生命周期管理
    'data_lifecycle' = '1095',           -- 3年后自动删除（天）
    'data_retention_days' = '30',        -- 30天Time Travel历史
    
    -- 缓存策略
    'partition.cache.policy.latest.count' = '7',  -- 缓存最近7个分区
    
    -- 变更跟踪
    'change_tracking' = 'true',          -- 启用Table Stream功能
    
    -- 字段长度限制（字节）
    'cz.storage.write.max.string.bytes' = '33554432',  -- STRING最大32MB
    'cz.storage.write.max.binary.bytes' = '33554432',  -- BINARY最大32MB
    'cz.storage.write.max.json.bytes' = '33554432'     -- JSON最大32MB
);
```

### 属性使用说明

| 属性名                                 | 说明             | 取值范围       | 默认值             |
| ----------------------------------- | -------------- | ---------- | --------------- |
| data\_lifecycle                     | 数据生命周期（天）      | >0或-1（不启用） | -1              |
| data\_retention\_days               | Time Travel保留期 | 0-90       | 1               |
| partition.cache.policy.latest.count | 缓存最近N个分区       | >=0        | 0               |
| change\_tracking                    | 是否启用变更跟踪       | true/false | false           |
| cz.storage.write.max.string.bytes   | STRING最大长度     | >0         | 16777216 (16MB) |
| cz.storage.write.max.binary.bytes   | BINARY最大长度     | >0         | 16777216 (16MB) |
| cz.storage.write.max.json.bytes     | JSON最大长度       | >0         | 16777216 (16MB) |

***

## 建表模式推荐

### 1. 维度表模式

```sql
-- 标准维度表设计
CREATE TABLE dim_product (
    product_id INT PRIMARY KEY,
    product_code VARCHAR(50) NOT NULL,
    product_name VARCHAR(200) NOT NULL,
    category_id INT,
    brand_id INT,
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_date DATE,
    modified_date DATE,
    
    -- 审计字段
    created_by VARCHAR(50),
    modified_by VARCHAR(50),
    
    -- 索引优化
    INDEX bloom_code (product_code) BLOOMFILTER,
    INDEX bloom_category (category_id) BLOOMFILTER,
    INDEX inv_name (product_name) INVERTED PROPERTIES ('analyzer' = 'chinese')
) 
CLUSTERED BY (product_id) INTO 32 BUCKETS  -- 维度表通常较小
COMMENT '产品维度表';
```

### 2. 事实表模式

```sql
-- 大型事实表设计
CREATE TABLE fact_sales (
    -- 业务主键
    sale_id BIGINT IDENTITY(1),
    
    -- 维度外键
    date_id INT NOT NULL,
    product_id INT NOT NULL,
    customer_id BIGINT NOT NULL,
    store_id INT NOT NULL,
    
    -- 度量值
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) DEFAULT 0,
    tax_amount DECIMAL(10,2) DEFAULT 0,
    total_amount DECIMAL(18,2) GENERATED ALWAYS AS 
        (quantity * unit_price - discount_amount + tax_amount),
    
    -- 时间戳
    sale_time TIMESTAMP NOT NULL,
    
    -- 分区字段
    sale_date STRING GENERATED ALWAYS AS (date_format(sale_time, 'yyyy-MM-dd')),
    
    -- 索引
    INDEX bloom_product (product_id) BLOOMFILTER,
    INDEX bloom_customer (customer_id) BLOOMFILTER
) 
PARTITIONED BY (sale_date)
CLUSTERED BY (customer_id) SORTED BY (sale_time DESC) INTO 256 BUCKETS
PROPERTIES (
    'data_lifecycle' = '2555',  -- 7年保留
    'partition.cache.policy.latest.count' = '30'  -- 缓存30天
)
COMMENT '销售事实表';
```

### 3. 宽表模式

```sql
-- 宽表设计（星型模式去规范化）
CREATE TABLE user_behavior_wide (
    -- 用户维度
    user_id BIGINT,
    user_name VARCHAR(100),
    user_level VARCHAR(20),
    register_date DATE,
    
    -- 行为事实
    behavior_id BIGINT IDENTITY(1),
    behavior_type VARCHAR(50),
    behavior_time TIMESTAMP,
    
    -- 商品维度（冗余）
    product_id INT,
    product_name VARCHAR(200),
    category_name VARCHAR(100),
    brand_name VARCHAR(100),
    
    -- 计算字段
    behavior_date STRING GENERATED ALWAYS AS (date_format(behavior_time, 'yyyy-MM-dd')),
    behavior_hour INT GENERATED ALWAYS AS (hour(behavior_time))
) 
PARTITIONED BY (behavior_date, behavior_hour)
CLUSTERED BY (user_id) INTO 512 BUCKETS
COMMENT '用户行为宽表';
```

***

## 性能调优检查清单

### 建表前评估

* [ ] **数据量评估**：预估表的总大小和增长速度
* [ ] **查询模式**：明确主要的查询维度和过滤条件
* [ ] **更新频率**：确定是只追加还是需要更新删除
* [ ] **并发需求**：评估查询并发数和响应时间要求

### 分区设计检查

* [ ] **分区键选择**：选择查询中最常用的过滤字段
* [ ] **分区粒度**：确保单分区大小在100MB-1GB之间
* [ ] **分区数量**：避免产生过多分区（建议<10000）
* [ ] **转换分区**：考虑使用转换函数优化分区

### 分桶优化检查

* [ ] **分桶键选择**：优先选择JOIN键或高基数列
* [ ] **分桶数量**：根据数据量选择（总量/128MB-1GB）
* [ ] **排序策略**：为范围查询添加SORTED BY
* [ ] **数据倾斜**：避免选择倾斜严重的列作为分桶键

### 索引策略检查

* [ ] **布隆过滤器**：为高基数点查询列创建
* [ ] **倒排索引**：为文本搜索列创建
* [ ] **向量索引**：为向量搜索场景创建
* [ ] **索引维护**：定期执行BUILD INDEX
* [ ] **索引评估**：监控索引使用率和效果

***

## 常见问题与解决方案

### Q1: 如何处理超大表（>10TB）。

```sql
-- 多级分区策略
CREATE TABLE huge_table (
    id BIGINT,
    event_time TIMESTAMP,
    region VARCHAR(10),
    data STRING,
    
    -- 三级分区
    year INT GENERATED ALWAYS AS (year(event_time)),
    month INT GENERATED ALWAYS AS (month(event_time)),
    day INT GENERATED ALWAYS AS (day(event_time))
) 
PARTITIONED BY (year, month, day, region)
CLUSTERED BY (id) INTO 2048 BUCKETS;
```

### Q2: 如何优化实时写入？

```sql
-- 实时写入优化表设计
CREATE TABLE realtime_events (
    event_id BIGINT PRIMARY KEY,  -- 支持去重
    event_data JSON,
    ingest_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 小时级分区减少写入冲突
    ingest_hour INT GENERATED ALWAYS AS (hour(ingest_time)),
    ingest_date STRING GENERATED ALWAYS AS (date_format(ingest_time, 'yyyy-MM-dd'))
) 
PARTITIONED BY (ingest_date, ingest_hour)
CLUSTERED BY (event_id) INTO 64 BUCKETS;  -- 适度分桶
```

### Q3: 如何设计SCD（缓慢变化维度）？

```sql
-- Type 2 SCD设计
CREATE TABLE dim_customer_scd (
    customer_id BIGINT,
    customer_name VARCHAR(200),
    customer_level VARCHAR(20),
    effective_date DATE,
    expiry_date DATE,
    is_current BOOLEAN,
    
    PRIMARY KEY (customer_id, effective_date)
) 
CLUSTERED BY (customer_id, effective_date) 
SORTED BY (customer_id, effective_date)  -- 主键表必须使用ASC排序
INTO 128 BUCKETS
COMMENT 'Customer dimension with SCD Type 2';
```

### Q4: 如何调整字段长度限制？

```sql
-- 调整STRING/BINARY/JSON字段的最大长度
ALTER TABLE large_content_table SET PROPERTIES (
    'cz.storage.write.max.string.bytes' = '67108864',  -- 64MB
    'cz.storage.write.max.json.bytes' = '33554432'     -- 32MB
);
```

***

## 迁移成功要素总结

### 技术栈迁移快速参考

| 源系统            | 关键迁移点               | Lakehouse优势 |
| -------------- | ------------------- | ----------- |
| **Spark**      | DataFrame → SQL DDL | 标准SQL降低门槛   |
| **Hive**       | 分区语法完全兼容            | 性能提升100x    |
| **MaxCompute** | 函数基本一致              | 弹性资源更灵活     |
| **Snowflake**  | 增加显式优化              | 成本可控        |
| **Databricks** | Delta理念相通           | 纯SQL更简洁     |
| **传统DB**       | OLTP → OLAP思维       | 扩展性无限       |

### 建表最佳实践总结

1. **合理分区**：选择低基数、查询常用的字段
2. **适度分桶**：根据数据量选择，避免过度分桶
3. **索引精准**：只为必要的列创建索引
4. **生成列巧用**：减少ETL复杂度
5. **生命周期管理**：设置合理的保留期
6. **主键谨慎**：仅在CDC场景使用
7. **测试先行**：小数据集验证后再大规模应用

### 性能优化效果预期

通过遵循本指南的建表最佳实践：

* **查询性能**：相比Hive提升10-100倍
* **存储效率**：列式压缩节省60-80%空间
* **维护成本**：自动化管理降低90%人工
* **扩展能力**：支持PB级数据规模

***

## 重要约束与限制总结

### 主键表约束

* **CLUSTERED BY**: 必须包含所有主键列
* **SORTED BY**: 必须包含所有主键列且只能使用升序（ASC）
* **PARTITIONED BY**: 分区列必须是主键的子集
* **生成列限制**: 主键表不能使用生成列作为分区键

### 生成列限制

* 不能用于 `CLUSTERED BY` 或 `SORTED BY`
* 不支持非确定性函数（如 `CURRENT_DATE`、`RANDOM`、`CURRENT_TIMESTAMP`）
* 不支持聚合函数、窗口函数或表函数
* 插入时不能为生成列指定值

### 索引约束

* 索引名必须在整个数据库中唯一
* BLOOMFILTER索引创建后不支持 `BUILD INDEX`
* 倒排索引必须指定分析器（analyzer）
* 向量索引不支持在ORDER BY或GROUP BY中使用

### 数据类型限制

* 自增列（IDENTITY）只支持 `BIGINT` 类型
* VARCHAR最大长度为1048576（约1MB）
* STRING/BINARY/JSON默认最大16MB，可通过属性调整
* 分区列不支持 `FLOAT`、`DOUBLE`、`DECIMAL` 等浮点类型
* VECTOR类型元素支持tinyint、int、float

### 分区限制

* 单个任务最多写入2048个分区（可通过参数调整）
* 转换分区函数使用 `years`、`months`、`days`、`hours`（注意复数形式）
* 分区列不支持复杂数据类型（ARRAY、MAP、STRUCT）

***

## 总结

云器Lakehouse的CREATE TABLE功能为企业提供了强大、灵活、高性能的表管理能力。无论您来自哪种技术背景，都能快速上手并发挥系统的最大价值。通过本指南的详细说明和丰富示例，相信您已经掌握了在Lakehouse中创建高效数据表的全部技能。

立即开始您的Lakehouse之旅，体验下一代数据仓库的强大威力！

***

**注意**：本文档基于Lakehouse 2025年6月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。

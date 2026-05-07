# 云器Lakehouse SELECT语句使用指南

## 文档简介

欢迎使用云器Lakehouse！本指南将帮助您快速掌握Lakehouse中SELECT语句的使用方法，无论您是数据分析师、工程师还是数据科学家，都能在这里找到所需的技术指导。

### 📖 **本文档包含什么**

* **快速上手指导**：如果您习惯了其他数据库系统，我们会帮您快速适应
* **完整语法参考**：从基础查询到高级功能的详细说明
* **实战示例**：所有代码都经过实际环境验证，可以直接使用
* **性能优化**：列式存储、索引、分区等优化技巧
* **最佳实践**：避免常见错误，提升开发效率

### 🎯 **适用对象**

* 数据分析师：需要进行复杂数据查询和分析
* 数据工程师：构建ETL流程和数据管道
* 数据科学家：进行特征工程和模型训练数据准备
* 系统管理员：进行数据库管理和性能优化

### 💡 **如何使用本文档**

1. **新用户**：建议从"迁移用户指导"开始，了解与您熟悉系统的差异
2. **快速查询**：可直接跳转到相关章节查找特定语法
3. **深度学习**：按顺序阅读，系统掌握Lakehouse的所有查询功能
4. **问题排查**：查看"常见问题"部分获取解决方案

***

## 概述

云器Lakehouse基于ANSI SQL 2003标准实现，与现代SQL语法高度兼容，同时针对大数据和AI场景提供了丰富的扩展功能。无论您习惯使用哪种数据库系统，都能快速上手并发挥Lakehouse的强大能力。

### 🚀 **核心特性**

* **标准SQL兼容**：支持ANSI SQL 2003核心功能，兼容主流数据库语法
* **列式存储优化**：专为分析查询设计的高性能存储引擎
* **现代数据类型**：原生支持JSON、VECTOR等复杂数据类型
* **智能索引系统**：布隆过滤器、全文搜索、向量索引三种索引类型
* **AI/ML集成**：内置向量计算和全文搜索功能

***

## 迁移用户指导

如果您习惯了Spark、MySQL、PostgreSQL或其他数据库系统，本节将帮助您快速适应云器Lakehouse并避免常见错误。我们理解切换到新系统的挑战，因此准备了这份详细的对比指南。

### 🔄 **如果您习惯了Spark SQL**

#### ✅ **可以直接复用的技能**

```sql
-- 以下Spark SQL代码可以直接在Lakehouse中运行
SELECT customer_id, COUNT(*), SUM(amount)
FROM orders 
WHERE order_date >= '2024-01-01'
GROUP BY customer_id
HAVING COUNT(*) > 5;

-- 窗口函数完全兼容
SELECT 
    employee_id,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as rank
FROM employees;
```

#### ⚠️ **需要调整的语法**

**1. LATERAL VIEW语法**

```sql
-- ❌ Spark语法（不支持）
SELECT user_id, event 
FROM user_events LATERAL VIEW explode(event_array) AS event;

-- ✅ Lakehouse语法
SELECT user_id, explode(event_array) as event 
FROM user_events;
```

**2. 正则表达式函数**

```sql
-- ❌ Spark语法（不支持）
WHERE regexp_like(column_name, 'pattern')

-- ✅ Lakehouse替代方案
WHERE regexp_extract(column_name, 'pattern', 0) != ''
-- 或者使用LIKE
WHERE column_name LIKE '%pattern%'
```

**3. 类型转换差异**

```sql
-- ⚠️ 注意：转换失败时返回特殊值而非NULL
SELECT 
    TRY_CAST('abc' AS INT) as result,  -- 返回nan，不是NULL
    -- 安全转换方式
    CASE 
        WHEN TRY_CAST('abc' AS INT) IS NOT NULL 
             AND CAST(TRY_CAST('abc' AS INT) AS STRING) != 'nan'
        THEN TRY_CAST('abc' AS INT)
        ELSE 0
    END as safe_result;
```

**4. NULL值显示特性**

```sql
-- ⚠️ 数值类型和时间类型的NULL有特殊显示格式
SELECT 
    LAG(order_date) OVER (...) as prev_date,     -- 时间类型NULL显示为"NaT"
    LAG(customer_id) OVER (...) as prev_id,      -- 数值类型NULL显示为"nan"
    CASE 
        WHEN LAG(order_date) OVER (...) IS NULL  -- 但IS NULL判断仍然有效
        THEN 'First Record'
        ELSE 'Has Previous'
    END as status
FROM orders;
```

#### **复杂数据类型高级应用**

```sql
-- Spark SQL数组操作（直接兼容）
WITH user_events AS (
    SELECT 
        user_id,
        array('login', 'view_product', 'purchase') as event_sequence
    FROM user_activity
)
SELECT 
    user_id,
    event_sequence[0] as first_event,                    -- 索引从0开始（与Spark一致）
    size(event_sequence) as event_count,
    array_contains(event_sequence, 'purchase') as converted,
    explode(event_sequence) as individual_event          -- 注意：不需要LATERAL VIEW
FROM user_events;

-- Spark SQL结构体操作（完全兼容）
WITH customer_profiles AS (
    SELECT 
        customer_id,
        named_struct(
            'name', customer_name,
            'contact', named_struct(
                'email', email,
                'phone', phone
            )
        ) as profile
    FROM customers
)
SELECT 
    customer_id,
    profile.name as customer_name,           -- 点号访问语法与Spark一致
    profile.contact.email as email,
    profile.contact.phone as phone
FROM customer_profiles;
```

### 🗄️ **如果您习惯了MySQL/PostgreSQL**

#### ✅ **可以直接复用的技能**

```sql
-- 标准SQL查询完全兼容
SELECT c.customer_name, COUNT(o.order_id) as order_count
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id
WHERE c.registration_date >= '2024-01-01'
GROUP BY c.customer_id, c.customer_name;
```

#### 🔌 **MySQL用户的额外选择：MySQL协议支持**

【**预览发布】云器Lakehouse支持MySQL协议连接**！

```bash
# ✅ 可以使用熟悉的MySQL连接方式
# MySQL 8.x 连接方式
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com:3306/public?useSSL=true

# MySQL 5.x 连接方式  
jdbc:mysql://cn-shanghai-alicloud-mysql.api.clickzetta.com:3306/public?useSSL=false

# 命令行连接
mysql -h cn-shanghai-alicloud-mysql.api.clickzetta.com -P 3306 -u username -p database_name
```

**📊 主要用途**

* **BI报表工具**：无法使用自定义JDBC驱动的报表工具
* **遗留系统集成**：现有MySQL客户端应用快速接入
* **开发工具兼容**：使用熟悉的MySQL管理工具

**⚠️ 重要限制**

* **语法仍为Lakehouse**：虽然协议兼容，但SQL语法需使用Lakehouse标准
* **数据类型限制**：不支持MySQL特有类型（mediumint、text、blob、enum等）
* **功能限制**：不支持mysqldump、LOAD等MySQL特有命令

```sql
-- ❌ MySQL特有语法不支持
CREATE TABLE test (col MEDIUMINT);  -- 报错
SELECT CAST(value AS TEXT);         -- 报错

-- ✅ 使用Lakehouse对应类型
CREATE TABLE test (col INT);        -- 正确
SELECT CAST(value AS STRING);       -- 正确
```

**💡 选择建议**

* **优先推荐**：使用Lakehouse原生驱动获得完整功能
* **兼容场景**：无法使用原生驱动时选择MySQL协议

#### ⚠️ **关键差异与工具限制**

**1. 查询结果返回的工具限制**

> 🎯 **核心理念**：查询返回的数据量往往受到您使用的工具或客户端限制，而非数据库引擎本身的限制。

| 工具/客户端                      | 查询结果限制   | 适用场景     | 突破方案          |
| --------------------------- | -------- | -------- | ------------- |
| **Lakehouse Studio Web UI** | 最大10000行 | 数据探索、调试  | 添加WHERE条件过滤   |
| **JDBC客户端**                 | 无硬性限制\*  | 应用开发、ETL | 分批处理、流式读取     |
| **Python SDK**              | 无硬性限制\*  | 数据科学、脚本  | 分批处理、pandas分块 |
| **BI工具**                    | 各工具不同    | 报表展示     | 查阅具体工具文档      |
| **命令行工具**                   | 内存/配置限制  | 数据导出     | 调整配置或分批导出     |

\*注：无硬性限制指SQL引擎层面无限制，但仍受内存、网络等资源限制。

**2. 分页策略选择**

```sql
-- 📱 Web UI 数据探索策略（受10000行限制）
SELECT customer_id, order_count, total_amount
FROM customer_summary
WHERE registration_date >= '2024-01-01'  -- 先过滤
  AND customer_type = 'premium'
ORDER BY total_amount DESC
LIMIT 100;  -- 小批量查看

-- 💻 编程接口大数据处理策略（无硬性限制）
WITH batch_data AS (
    SELECT customer_id, order_id, amount
    FROM orders 
    WHERE order_date = '2024-06-01'
      AND customer_id BETWEEN :start_id AND :end_id  -- 批次范围
)
SELECT * FROM batch_data;

-- 🔄 推荐：基于游标的分页（适用所有工具）
SELECT customer_id, order_id, order_date, amount
FROM orders 
WHERE customer_id > :last_customer_id  -- 游标分页
  AND order_date >= '2024-01-01'
ORDER BY customer_id, order_id
LIMIT 1000;  -- 适中的批次大小
```

**3. 字符串函数兼容性**

```sql
-- ✅ MySQL风格函数大多兼容
SELECT 
    SUBSTRING(name, 1, 5) as substr_mysql,    -- 支持
    SUBSTR(name, 1, 5) as substr_standard,    -- 支持
    CONCAT_WS(',', field1, field2) as concat_ws,  -- 支持
    CONCAT(field1, ',', field2) as concat_std     -- 支持
FROM users;
```

**4. 索引概念差异**

```sql
-- ❌ 传统数据库思维
CREATE INDEX idx_name ON table(column);  -- 期望立即生效

-- ✅ Lakehouse正确做法
CREATE BLOOMFILTER INDEX idx_name ON TABLE table(column);  -- 仅对新数据生效
-- 如需对已有数据生效（仅部分索引类型支持）
BUILD INDEX idx_name ON table;
```

**5. 事务和锁定**

```sql
-- ⚠️ Lakehouse不支持传统事务语法
-- ❌ 不支持
BEGIN TRANSACTION;
UPDATE products SET price = price * 1.1;
COMMIT;

-- ✅ 使用批量更新或MERGE语句
MERGE INTO products p
USING (SELECT product_id, price * 1.1 as new_price FROM products) src
ON p.product_id = src.product_id
WHEN MATCHED THEN UPDATE SET price = src.new_price;
```

### 📊 **列式存储优化思维**

#### **传统行式 vs 列式存储**

```sql
-- ❌ 行式数据库思维：避免SELECT *
SELECT * FROM large_table WHERE id = 123;

-- ✅ 列式存储优化：明确指定列
SELECT customer_id, order_amount, order_date 
FROM large_table 
WHERE id = 123;

-- 💡 列式存储的优势
SELECT 
    product_category,
    AVG(price) as avg_price,  -- 只读取price列，性能优异
    COUNT(*) as product_count
FROM products 
GROUP BY product_category;
```

#### **分区概念理解**

```sql
-- 💡 分区表查询优化
-- ✅ 正确：直接使用分区字段
SELECT * FROM orders 
WHERE order_date >= '2024-06-01' 
  AND order_date <= '2024-06-30';

-- ❌ 错误：对分区字段使用函数
SELECT * FROM orders 
WHERE YEAR(order_date) = 2024;  -- 无法利用分区裁剪
```

### 🚨 **常见错误和解决方案**

#### **1. 数据类型选择错误**

```sql
-- ❌ 错误选择：JSON数据存储为字符串
CREATE TABLE user_profiles (
    user_id INT,
    profile_data STRING  -- 需要类型转换才能使用JSON函数
);

-- ✅ 正确选择：使用原生JSON类型
CREATE TABLE user_profiles (
    user_id INT,
    profile_data JSON    -- 直接支持JSON函数，性能更好
);

-- 查询语法对比
-- STRING类型：需要转换
SELECT user_id, json_extract_string(CAST(profile_data AS JSON), '$.age') as age
FROM user_profiles_string;

-- JSON类型：直接使用
SELECT user_id, json_extract_string(profile_data, '$.age') as age
FROM user_profiles_json;
```

#### **2. JOIN优化误区**

```sql
-- ❌ 传统数据库思维：大表在左
SELECT l.*, s.name
FROM large_table l
JOIN small_table s ON l.id = s.id;

-- ✅ Lakehouse优化：使用MAPJOIN提示
SELECT /*+ MAPJOIN(small_table) */ l.*, s.name
FROM large_table l
JOIN small_table s ON l.id = s.id;
```

#### **3. 聚合查询优化**

```sql
-- ❌ 低效：多次扫描大表
SELECT 
    (SELECT COUNT(*) FROM large_table WHERE status = 'active') as active_count,
    (SELECT COUNT(*) FROM large_table WHERE status = 'inactive') as inactive_count;

-- ✅ 高效：一次扫描
SELECT 
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
    SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive_count
FROM large_table;
```

### 💡 **快速适应建议**

#### **1. 优先使用的功能**

* **JSON数据类型**：替代字符串存储半结构化数据
* **VECTOR数据类型**：原生支持向量搜索
* **分区表**：按时间或业务维度分区
* **列式索引**：BLOOMFILTER、INVERTED、VECTOR
* **MySQL协议连接**：无法使用原生驱动时的兼容选择

#### **2. 性能优化习惯**

```sql
-- 好习惯：分区+列选择+索引
SELECT customer_id, order_amount
FROM orders 
WHERE order_date >= '2024-06-01'     -- 分区裁剪
  AND customer_type = 'premium'      -- 布隆过滤器索引
  AND match_any(description, '手机', map('analyzer', 'chinese'))  -- 全文索引
ORDER BY order_amount DESC
LIMIT 100;
```

#### **3. 避免的反模式**

```sql
-- ❌ 避免的模式
-- 1. 在分区字段上使用函数
WHERE YEAR(partition_date) = 2024

-- 2. 过度使用SELECT *
SELECT * FROM large_table

-- 3. 忽略数据类型优化
profile_json STRING  -- 应该用JSON类型

-- 4. 忽略工具限制的深度分页（Web UI）
-- 在Studio中查询大量数据时没有添加过滤条件

-- 5. 大表全量排序分页
SELECT * FROM huge_table ORDER BY random_column LIMIT 100 OFFSET 5000  -- 性能极差
```

### 📚 **学习路径建议**

无论您之前使用什么数据库系统，我们建议按以下路径学习：

1. **第一周**：熟悉基本查询语法，了解与您熟悉系统的差异
2. **第二周**：掌握数据类型系统，特别是JSON、VECTOR等现代类型
3. **第三周**：学习索引系统和性能优化技巧
4. **第四周**：深入分区表和高级功能应用

这样的学习节奏能帮助您在一个月内完全掌握Lakehouse的核心功能。

### 🔗 **快速参考**

| 功能类别      | 传统数据库                    | Lakehouse支持情况                 | 说明         |
| --------- | ------------------------ | ----------------------------- | ---------- |
| **连接协议**  | MySQL协议                  | ✅ 支持（预览版）                     | 适用于BI报表等场景 |
| **分页查询**  | `LIMIT n OFFSET m`       | ✅ 完全支持                        | 工具显示限制各不同  |
| **正则函数**  | `regexp_like()`          | ❌ 使用 `regexp_extract() != ''` | 函数名差异      |
| **字符串函数** | `SUBSTRING()`            | ✅ 完全支持                        | MySQL语法兼容  |
| **字符串连接** | `CONCAT_WS()`            | ✅ 完全支持                        | MySQL语法兼容  |
| **数组展开**  | `LATERAL VIEW explode()` | ❌ 使用 `explode()`              | 语法简化       |
| **事务语法**  | `BEGIN/COMMIT`           | ❌ 使用批量操作                      | 列式存储特性     |
| **查询优化**  | `SELECT *`               | ⚠️ 建议明确列名                     | 列式存储优化     |

***

## 基本语法

### SELECT语句结构

Lakehouse SELECT语句遵循标准SQL语法，支持完整的查询功能：

```sql
SELECT [ALL | DISTINCT] select_expr [, select_expr ...]
[FROM table_reference [, table_reference ...]]
[WHERE where_condition]
[GROUP BY grouping_element [, grouping_element ...]]
[HAVING having_condition]
[ORDER BY sort_item [, sort_item ...]]
[LIMIT row_count]
```

### 基本查询示例

```sql
-- 基础查询
SELECT 
    customer_id,
    customer_name,
    registration_date,
    total_orders
FROM customers
WHERE registration_date >= '2024-01-01'
ORDER BY total_orders DESC
LIMIT 100;

-- 聚合查询
SELECT 
    product_category,
    COUNT(*) as product_count,
    AVG(price) as avg_price,
    SUM(sales_amount) as total_sales
FROM products
GROUP BY product_category
HAVING COUNT(*) > 10;
```

### 增强语法特性

#### EXCEPT子句

Lakehouse提供了EXCEPT子句用于排除指定列：

```sql
-- 排除敏感字段
SELECT * EXCEPT(password, credit_card, ssn)
FROM user_accounts;

-- 排除多个字段
SELECT * EXCEPT(internal_id, created_by, updated_by)
FROM public_data;
```

***

## 数据类型系统

### 核心数据类型

| 类型分类 | 数据类型                           | 说明           | 示例                                            |
| ---- | ------------------------------ | ------------ | --------------------------------------------- |
| 数值类型 | TINYINT, SMALLINT, INT, BIGINT | 整数类型         | `SELECT 123::INT`                             |
|      | FLOAT, DOUBLE                  | 浮点数类型        | `SELECT 3.14::DOUBLE`                         |
|      | DECIMAL(p,s)                   | 精确数值类型       | `SELECT 999.99::DECIMAL(10,2)`                |
| 字符类型 | STRING                         | 变长字符串，最大16MB | `SELECT 'Hello'::STRING`                      |
|      | VARCHAR(n), CHAR(n)            | 定长/变长字符串     | `SELECT 'Text'::VARCHAR(50)`                  |
| 日期时间 | DATE                           | 日期类型         | `SELECT '2024-06-01'::DATE`                   |
|      | TIMESTAMP\_LTZ                 | 带时区时间戳       | `SELECT CURRENT_TIMESTAMP()`                  |
|      | TIMESTAMP\_NTZ                 | 无时区时间戳       | `SELECT '2024-06-01 12:00:00'::TIMESTAMP_NTZ` |
| 布尔类型 | BOOLEAN                        | 布尔值          | `SELECT true::BOOLEAN`                        |
| 二进制  | BINARY                         | 二进制数据        | `SELECT X'48656C6C6F'::BINARY`                |

### 复杂数据类型

#### ARRAY类型

```sql
-- 创建和操作数组
SELECT 
    array(1, 2, 3, 4, 5) as numbers,
    array('apple', 'banana', 'orange') as fruits,
    array_contains(array(1, 2, 3), 2) as contains_check,
    size(array(1, 2, 3, 4)) as array_length;

-- 数组访问和处理
WITH data AS (
    SELECT array('a', 'b', 'c', 'd') as letters
)
SELECT 
    letters[0] as first_letter,    -- 索引从0开始
    letters[3] as last_letter,
    slice(letters, 1, 2) as middle_slice,  -- 从索引1开始，取2个元素
    array_sort(letters) as sorted_letters
FROM data;
```

**⚠️ 重要说明**：`slice(array, start_index, length)` 函数参数含义：

* `start_index`：起始索引位置（从0开始）
* `length`：要提取的元素个数
* 示例：`slice(array('a','b','c','d'), 1, 2)` 返回 `['b', 'c']`

#### STRUCT类型

```sql
-- 创建和访问结构体
SELECT 
    named_struct('name', 'Alice', 'age', 30, 'city', 'Seattle') as person,
    named_struct(
        'street', '123 Main St',
        'city', 'Seattle',
        'zipcode', '98101'
    ) as address;

-- 结构体字段访问
WITH customer_data AS (
    SELECT 
        1 as id,
        named_struct(
            'name', 'Alice Johnson',
            'contact', named_struct(
                'email', 'alice@example.com',
                'phone', '555-1234'
            )
        ) as profile
)
SELECT 
    id,
    profile.name as customer_name,
    profile.contact.email as email,
    profile.contact.phone as phone
FROM customer_data;
```

#### JSON类型

JSON作为一等公民提供原生支持，具有优异的查询性能：

```sql
-- JSON字面量和函数
SELECT 
    JSON '{"name": "Alice", "age": 30, "skills": ["Python", "SQL"]}' as profile,
    json_extract_string(JSON '{"name": "Alice"}', '$.name') as name,
    json_extract_int(JSON '{"age": 30}', '$.age') as age,
    json_extract(JSON '{"skills": ["Python", "SQL"]}', '$.skills') as skills;

-- JSON查询和过滤
WITH user_profiles AS (
    SELECT 
        1 as user_id,
        JSON '{"name": "Alice", "department": "Engineering", "skills": ["Python", "Java"]}' as profile
    UNION ALL
    SELECT 2, JSON '{"name": "Bob", "department": "Sales", "skills": ["Excel", "CRM"]}'
)
SELECT 
    user_id,
    json_extract_string(profile, '$.name') as name,
    json_extract_string(profile, '$.department') as department,
    json_extract(profile, '$.skills[0]') as primary_skill
FROM user_profiles
WHERE json_extract_string(profile, '$.department') = 'Engineering';
```

#### VECTOR类型

专为AI/ML场景设计的向量数据类型：

```sql
-- 向量创建和计算
SELECT 
    VECTOR(0.1, 0.2, 0.3, 0.4) as embedding_vector,
    l2_distance(VECTOR(0.1, 0.2, 0.3), VECTOR(0.4, 0.5, 0.6)) as l2_dist,
    cosine_distance(VECTOR(0.1, 0.2, 0.3), VECTOR(0.4, 0.5, 0.6)) as cosine_sim,
    dot_product(VECTOR(1.0, 2.0, 3.0), VECTOR(2.0, 3.0, 4.0)) as dot_prod;
```

### 类型转换

#### 基本转换语法

Lakehouse支持多种类型转换语法：

```sql
-- 三种转换方式
SELECT 
    CAST(123 AS STRING) as cast_syntax,
    123::STRING as double_colon_syntax,
    STRING(123) as function_syntax;
```

#### 安全类型转换

转换失败时的处理机制：

```sql
-- TRY_CAST安全转换
SELECT 
    '123' as original,
    TRY_CAST('123' AS INT) as valid_conversion,      -- 返回123
    TRY_CAST('abc' AS INT) as invalid_conversion,    -- 返回nan
    
    -- 转换验证
    CASE 
        WHEN TRY_CAST('123' AS INT) IS NOT NULL 
             AND CAST(TRY_CAST('123' AS INT) AS STRING) != 'nan'
        THEN 'VALID'
        ELSE 'INVALID'
    END as conversion_status;
```

### 🚨 **NULL值显示特性**

**重要说明**：Lakehouse中NULL值的显示具有特殊性：

```sql
-- ⚠️ 数值类型和时间类型的NULL值有特殊显示格式
SELECT 
    customer_id,
    LAG(customer_id) OVER (ORDER BY registration_date) as prev_id,        -- 数值NULL显示为"nan"
    LAG(registration_date) OVER (ORDER BY registration_date) as prev_date, -- 时间NULL显示为"NaT"
    
    -- 但IS NULL/IS NOT NULL逻辑判断完全正常
    CASE 
        WHEN LAG(customer_id) OVER (ORDER BY registration_date) IS NULL 
        THEN 'First Customer'
        ELSE 'Has Previous'
    END as position_status
FROM customers;
```

**关键要点**：

* **数值类型**（INT、DOUBLE等）的NULL显示为 `"nan"`
* **时间类型**（DATE、TIMESTAMP等）的NULL显示为 `"NaT"`
* **字符类型**（STRING、VARCHAR等）的NULL正常显示
* **所有类型的`IS NULL`和`IS NOT NULL`判断都正常工作**

***

## 函数库

### 字符串函数

```sql
SELECT 
    -- 基础字符串操作
    upper('hello world') as uppercase,
    lower('HELLO WORLD') as lowercase,
    length('hello') as str_length,
    substr('hello world', 1, 5) as substring,
    trim('  hello  ') as trimmed,
    
    -- 字符串连接和替换
    concat('hello', ' ', 'world') as concatenated,
    replace('hello world', 'world', 'lakehouse') as replaced,
    
    -- 字符串分割和提取
    split('a,b,c,d', ',') as split_array,
    regexp_extract('abc123def', '[0-9]+', 0) as extracted_number,
    regexp_replace('hello123world', '[0-9]+', 'XXX') as pattern_replaced;
```

### 数学函数

```sql
SELECT 
    -- 基础数学运算
    abs(-10) as absolute_value,
    round(3.14159, 2) as rounded,
    ceil(3.1) as ceiling,
    floor(3.9) as floor,
    
    -- 高级数学函数
    sqrt(16) as square_root,
    pow(2, 3) as power,
    mod(10, 3) as modulo,
    greatest(1, 5, 3, 8, 2) as max_value,
    least(1, 5, 3, 8, 2) as min_value;
```

### 日期时间函数

```sql
SELECT 
    -- 当前时间
    current_date() as today,
    current_timestamp() as now,
    localtimestamp() as local_now,
    
    -- 日期运算
    date_add('2024-06-01', 30) as add_days,
    date_sub('2024-06-01', 7) as subtract_days,
    datediff('2024-06-10', '2024-06-01') as date_difference,
    
    -- 日期提取
    year('2024-06-01') as extract_year,
    month('2024-06-01') as extract_month,
    day('2024-06-01') as extract_day,
    
    -- 格式化
    date_format('2024-06-01', 'yyyy-MM-dd') as formatted_date;
```

### 聚合函数

```sql
-- 基础聚合
SELECT 
    product_category,
    COUNT(*) as total_count,
    COUNT(DISTINCT customer_id) as unique_customers,
    SUM(sales_amount) as total_sales,
    AVG(sales_amount) as average_sales,
    MIN(sales_amount) as min_sales,
    MAX(sales_amount) as max_sales,
    STDDEV(sales_amount) as sales_stddev
FROM sales_data
GROUP BY product_category;

-- 高级聚合
SELECT 
    product_category,
    collect_list(product_name) as product_names,
    collect_set(brand) as unique_brands,
    percentile(sales_amount, 0.5) as median_sales,
    percentile(sales_amount, array(0.25, 0.5, 0.75)) as quartiles
FROM sales_data
GROUP BY product_category;
```

### 窗口函数

```sql
-- 排名函数
SELECT 
    employee_name,
    department,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) as row_num,
    RANK() OVER (PARTITION BY department ORDER BY salary DESC) as salary_rank,
    DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) as dense_rank,
    PERCENT_RANK() OVER (PARTITION BY department ORDER BY salary) as percentile_rank,
    CUME_DIST() OVER (PARTITION BY department ORDER BY salary) as cumulative_dist
FROM employees;

-- 偏移函数
SELECT 
    employee_name,
    salary,
    hire_date,
    LAG(salary, 1) OVER (ORDER BY hire_date) as prev_salary,
    LEAD(salary, 1) OVER (ORDER BY hire_date) as next_salary,
    FIRST_VALUE(salary) OVER (ORDER BY hire_date) as first_salary,
    LAST_VALUE(salary) OVER (
        ORDER BY hire_date 
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as last_salary
FROM employees;

-- 聚合窗口函数
SELECT 
    employee_name,
    department,
    salary,
    SUM(salary) OVER (PARTITION BY department) as dept_total,
    AVG(salary) OVER (PARTITION BY department) as dept_average,
    COUNT(*) OVER (PARTITION BY department) as dept_count,
    
    -- 移动窗口
    AVG(salary) OVER (
        ORDER BY hire_date 
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) as moving_avg_3months
FROM employees;
```

***

## 查询进阶

### JOIN操作

#### 基础JOIN类型

```sql
-- INNER JOIN
SELECT c.customer_name, o.order_id, o.total_amount
FROM customers c
INNER JOIN orders o ON c.customer_id = o.customer_id;

-- LEFT JOIN
SELECT c.customer_name, o.order_id, o.total_amount
FROM customers c
LEFT JOIN orders o ON c.customer_id = o.customer_id;

-- RIGHT JOIN
SELECT c.customer_name, o.order_id, o.total_amount
FROM customers c
RIGHT JOIN orders o ON c.customer_id = o.customer_id;

-- FULL OUTER JOIN
SELECT c.customer_name, o.order_id, o.total_amount
FROM customers c
FULL OUTER JOIN orders o ON c.customer_id = o.customer_id;
```

#### JOIN优化提示

```sql
-- 广播JOIN提示
SELECT /*+ MAPJOIN(small_table) */
    l.large_table_id,
    s.small_table_value
FROM large_table l
JOIN small_table s ON l.join_key = s.join_key;

-- 排序合并JOIN提示
SELECT /*+ SORTMERGEJOIN(table1, table2) */
    t1.column1,
    t2.column2
FROM table1 t1
JOIN table2 t2 ON t1.key = t2.key;
```

### 子查询和CTE

#### 通用表表达式(CTE)

```sql
-- 基础CTE
WITH monthly_sales AS (
    SELECT 
        date_format(order_date, 'yyyy-MM') as month,
        SUM(total_amount) as monthly_total
    FROM orders
    GROUP BY date_format(order_date, 'yyyy-MM')
),
avg_monthly_sales AS (
    SELECT AVG(monthly_total) as avg_monthly
    FROM monthly_sales
)
SELECT 
    ms.month,
    ms.monthly_total,
    ams.avg_monthly,
    ms.monthly_total - ams.avg_monthly as variance
FROM monthly_sales ms
CROSS JOIN avg_monthly_sales ams
ORDER BY ms.month;
```

#### 层次化查询

对于层次化数据处理，可以使用多级JOIN或自连接方式：

```sql
-- 组织架构查询示例（使用自连接方式）
WITH employee_levels AS (
    -- 第一级：顶级管理者
    SELECT employee_id, employee_name, manager_id, 1 as level
    FROM employees
    WHERE manager_id IS NULL
    
    UNION ALL
    
    -- 第二级：直接下属
    SELECT e.employee_id, e.employee_name, e.manager_id, 2 as level
    FROM employees e
    INNER JOIN employees m ON e.manager_id = m.employee_id
    WHERE m.manager_id IS NULL
    
    UNION ALL
    
    -- 第三级：更深层下属
    SELECT e.employee_id, e.employee_name, e.manager_id, 3 as level
    FROM employees e
    INNER JOIN employees m1 ON e.manager_id = m1.employee_id
    INNER JOIN employees m2 ON m1.manager_id = m2.employee_id
    WHERE m2.manager_id IS NULL
)
SELECT * FROM employee_levels
ORDER BY level, employee_name;
```

#### 相关子查询

```sql
-- 相关子查询示例
SELECT 
    product_id,
    product_name,
    price,
    (SELECT AVG(price) 
     FROM products p2 
     WHERE p2.category = p1.category) as category_avg_price
FROM products p1
WHERE price > (
    SELECT AVG(price) 
    FROM products p2 
    WHERE p2.category = p1.category
);
```

***

## 高级特性

### 全文搜索

内置的全文搜索功能，支持多种匹配模式：

```sql
-- 全文搜索函数
WITH documents AS (
    SELECT 1 as doc_id, '人工智能和机器学习技术正在快速发展' as content
    UNION ALL SELECT 2, '深度学习是机器学习的一个重要分支'
    UNION ALL SELECT 3, '云计算为人工智能提供了强大的计算能力'
)
SELECT 
    doc_id,
    content,
    -- 匹配所有关键词
    match_all(content, '机器学习 人工智能', map('analyzer', 'chinese')) as matches_all,
    -- 匹配任意关键词
    match_any(content, '机器学习 深度学习', map('analyzer', 'chinese')) as matches_any,
    -- 短语匹配
    match_phrase(content, '机器学习技术', map('analyzer', 'chinese')) as phrase_match
FROM documents
WHERE match_all(content, '机器学习', map('analyzer', 'chinese'));
```

### 向量搜索

支持高效的向量相似性搜索：

```sql
-- 向量相似性搜索
WITH document_embeddings AS (
    SELECT 1 as doc_id, 'AI技术文档' as title, VECTOR(0.1, 0.3, 0.7, 0.2) as embedding
    UNION ALL SELECT 2, '机器学习指南', VECTOR(0.2, 0.4, 0.6, 0.3)
    UNION ALL SELECT 3, '数据库教程', VECTOR(0.8, 0.1, 0.2, 0.4)
),
search_query AS (
    SELECT VECTOR(0.1, 0.3, 0.7, 0.2) as query_vector
)
SELECT 
    d.doc_id,
    d.title,
    cosine_distance(d.embedding, s.query_vector) as similarity_score
FROM document_embeddings d
CROSS JOIN search_query s
WHERE cosine_distance(d.embedding, s.query_vector) < 0.5
ORDER BY similarity_score
LIMIT 10;
```

### 历史数据查询

对于需要查询历史数据的场景，建议使用时间字段进行过滤：

```sql
-- 查询指定时间范围的数据
SELECT * FROM orders 
WHERE created_time >= '2024-06-01 00:00:00'
  AND created_time <= '2024-06-01 23:59:59';

-- 查询相对时间的数据
SELECT * FROM orders 
WHERE created_time >= CURRENT_TIMESTAMP() - INTERVAL '1' HOUR;
```

***

## 索引优化

云器Lakehouse支持三种类型的索引来优化查询性能，每种索引针对不同的查询场景：

### 索引类型概览

| 索引类型        | 适用场景    | 支持的数据类型                          | 查询函数                                |
| ----------- | ------- | -------------------------------- | ----------------------------------- |
| BLOOMFILTER | 等值查询过滤  | 除interval、struct、map、array外的基本类型 | 标准WHERE条件                           |
| INVERTED    | 全文搜索    | STRING类型                         | match\_all、match\_any、match\_phrase |
| VECTOR      | 向量相似性搜索 | VECTOR类型                         | cosine\_distance、l2\_distance等      |

### 1. 布隆过滤器索引 (BLOOMFILTER INDEX)

布隆过滤器索引用于快速过滤等值查询，特别适用于高基数列。

#### 创建语法

```sql
-- 基础语法
CREATE BLOOMFILTER INDEX [IF NOT EXISTS] index_name 
ON TABLE [schema].table_name(column_name) 
[COMMENT 'comment'] 
[PROPERTIES ('key'='value')];

-- 示例
CREATE BLOOMFILTER INDEX idx_customer_id 
ON TABLE orders(customer_id) 
COMMENT '客户ID布隆过滤器索引';
```

#### 使用示例

```sql
-- 创建测试表
CREATE TABLE product_sales (
    product_id INT,
    category STRING,
    sales_amount DOUBLE,
    sale_date DATE
);

-- 创建布隆过滤器索引
CREATE BLOOMFILTER INDEX idx_category_bloom 
ON TABLE product_sales(category) 
COMMENT '产品类别布隆过滤器索引';

-- 使用索引进行等值查询（索引会自动应用）
SELECT product_id, sales_amount
FROM product_sales
WHERE category = '电子产品';  -- 布隆过滤器加速此查询
```

#### 限制说明

* **仅对新数据生效**：创建后只对新写入的数据有效，已有数据需要重写
* **不支持BUILD INDEX**：布隆过滤器索引不支持对存量数据构建索引
* **数据类型限制**：不支持interval、struct、map、array等复杂类型

### 2. 倒排索引 (INVERTED INDEX)

倒排索引用于全文搜索功能，支持多种文本分析器。

#### 创建语法

```sql
-- 建表时创建
CREATE TABLE documents (
    doc_id INT,
    title STRING,
    content STRING,
    INDEX content_idx (content) INVERTED COMMENT '内容倒排索引'
);

-- 已有表添加索引
CREATE INVERTED INDEX [IF NOT EXISTS] index_name 
ON TABLE [schema].table_name(column_name) 
PROPERTIES('analyzer'='analyzer_type');
```

#### 分析器类型

| 分析器     | 适用场景  | 说明          |
| ------- | ----- | ----------- |
| chinese | 中文文本  | 支持中文分词      |
| english | 英文文本  | 英文分词和词干提取   |
| keyword | 关键词匹配 | 不分词，完整匹配    |
| unicode | 通用文本  | Unicode字符处理 |

#### 使用示例

```sql
-- 创建倒排索引
CREATE INVERTED INDEX IF NOT EXISTS idx_content_search 
ON TABLE documents(content) 
PROPERTIES('analyzer'='chinese');

-- 构建索引（对已有数据生效）
BUILD INDEX idx_content_search ON documents;

-- 全文搜索查询
-- 匹配所有关键词
SELECT doc_id, title, content
FROM documents
WHERE match_all(content, '人工智能 机器学习', map('analyzer', 'chinese'));

-- 匹配任意关键词
SELECT doc_id, title, content
FROM documents
WHERE match_any(content, '人工智能 深度学习', map('analyzer', 'chinese'));

-- 短语匹配
SELECT doc_id, title, content
FROM documents
WHERE match_phrase(content, '机器学习技术', map('analyzer', 'chinese'));
```

#### 支持分区构建

```sql
-- 按分区构建索引
BUILD INDEX idx_content_search ON documents 
WHERE partition_date >= '2024-06-01' AND partition_date <= '2024-06-30';
```

### 3. 向量索引 (VECTOR INDEX)

向量索引专为AI/ML场景设计，支持高效的向量相似性搜索。

#### 创建语法

```sql
CREATE VECTOR INDEX [IF NOT EXISTS] index_name 
ON TABLE [schema].table_name(column_name) 
PROPERTIES(
    "scalar.type" = "scalar_type",
    "distance.function" = "distance_function",
    "ef_construction" = "ef_value",
    "M" = "M_value"
);
```

#### 参数说明

| 参数                | 可选值                                                                  | 默认值              | 说明              |
| ----------------- | -------------------------------------------------------------------- | ---------------- | --------------- |
| scalar.type       | f32, f16, i8, b1                                                     | f32              | 向量标量类型          |
| distance.function | cosine\_distance, l2\_distance, jaccard\_distance, hamming\_distance | cosine\_distance | 距离计算函数          |
| ef\_construction  | 整数                                                                   | 200              | 构建参数，影响召回率和构建时间 |
| M                 | 整数                                                                   | 16               | 图的连接度，影响查询性能    |

#### 使用示例

```sql
-- 创建包含向量列的表
CREATE TABLE document_embeddings (
    doc_id INT,
    title STRING,
    embedding VECTOR(512),  -- 512维向量
    created_at TIMESTAMP_LTZ
);

-- 创建向量索引
CREATE VECTOR INDEX IF NOT EXISTS idx_doc_embedding 
ON TABLE document_embeddings(embedding) 
PROPERTIES(
    "scalar.type" = "f32",
    "distance.function" = "cosine_distance",
    "ef_construction" = "200",
    "M" = "16"
) COMMENT '文档向量嵌入索引';

-- 构建索引
BUILD INDEX idx_doc_embedding ON document_embeddings;

-- 向量相似性搜索
WITH query_vector AS (
    SELECT VECTOR(0.1, 0.2, 0.3, ...) as search_embedding  -- 查询向量
)
SELECT 
    d.doc_id,
    d.title,
    cosine_distance(d.embedding, q.search_embedding) as similarity_score
FROM document_embeddings d
CROSS JOIN query_vector q
WHERE cosine_distance(d.embedding, q.search_embedding) < 0.5  -- 相似度阈值
ORDER BY similarity_score
LIMIT 10;

-- 使用其他距离函数
SELECT 
    doc_id,
    title,
    l2_distance(embedding, VECTOR(0.1, 0.2, 0.3)) as l2_dist,
    dot_product(embedding, VECTOR(0.1, 0.2, 0.3)) as dot_prod
FROM document_embeddings
ORDER BY l2_dist
LIMIT 5;
```

### 索引管理

#### 创建索引的IF NOT EXISTS支持

**✅ 语法支持**：所有三种索引类型都支持 `IF NOT EXISTS` 语法：

```sql
-- 布隆过滤器索引
CREATE BLOOMFILTER INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);

-- 倒排索引
CREATE INVERTED INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);

-- 向量索引
CREATE VECTOR INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);
```

**⚠️ 当前实现说明**：虽然语法已支持，但在同一列创建相同类型的重复索引时仍可能报错。这表明语法解析正确，但逻辑检查还在持续完善中。

#### 构建索引 (BUILD INDEX)

对已有数据构建索引，仅支持INVERTED和VECTOR索引：

```sql
-- 全表构建
BUILD INDEX index_name ON [schema].table_name;

-- 分区构建
BUILD INDEX index_name ON table_name 
WHERE partition_col = 'value' AND other_col > 100;

-- 多分区构建
BUILD INDEX index_name ON table_name 
WHERE partition_date >= '2024-06-01' 
  AND partition_date <= '2024-06-30';
```

#### 查看索引信息

```sql
-- 查看表的所有索引
DESCRIBE TABLE table_name;

-- 查看特定索引详情
DESCRIBE INDEX index_name;

-- 扩展索引信息
DESCRIBE INDEX EXTENDED index_name;
```

#### 删除索引

```sql
DROP INDEX [IF EXISTS] index_name;
```

### 查询优化建议

#### 复合搜索：结合多种索引

```sql
-- 结合布隆过滤器和全文搜索
SELECT doc_id, title, content
FROM documents
WHERE category = 'technology'  -- 布隆过滤器索引加速
  AND match_any(content, '人工智能', map('analyzer', 'chinese'));  -- 倒排索引搜索

-- 向量搜索与过滤结合
SELECT doc_id, title, embedding,
       cosine_distance(embedding, VECTOR(0.1, 0.2, 0.3)) as score
FROM document_embeddings
WHERE doc_type = 'article'  -- 先过滤再向量搜索
  AND cosine_distance(embedding, VECTOR(0.1, 0.2, 0.3)) < 0.3
ORDER BY score
LIMIT 20;
```

***

## 性能优化

### 查询优化原则

#### 分区裁剪优化

```sql
-- 正确的分区查询方式
SELECT *
FROM partitioned_table
WHERE date_partition >= '2024-06-01'
  AND date_partition <= '2024-06-30'
  AND status = 'active';

-- 避免的反模式
-- WHERE year(date_partition) = 2024  -- 无法利用分区裁剪
```

#### 谓词下推优化

```sql
-- 在JOIN前过滤数据
WITH filtered_orders AS (
    SELECT customer_id, order_id, total_amount
    FROM orders
    WHERE order_date >= '2024-06-01'
      AND total_amount > 100
),
active_customers AS (
    SELECT customer_id, customer_name
    FROM customers
    WHERE status = 'active'
)
SELECT c.customer_name, o.order_id, o.total_amount
FROM active_customers c
JOIN filtered_orders o ON c.customer_id = o.customer_id;
```

#### 列裁剪优化

```sql
-- 只选择需要的列
SELECT customer_id, customer_name, total_orders
FROM customers
WHERE registration_date >= '2024-01-01';

-- 使用EXCEPT排除不需要的列
SELECT * EXCEPT(internal_notes, created_by, updated_by)
FROM customer_details;
```

### 分页查询优化策略

根据使用的工具选择合适的分页策略：

#### **📱 Web UI 分页策略**

适用于：Lakehouse Studio界面探索（受10000行显示限制）

```sql
-- 策略1：条件过滤 + 小批量查看
SELECT customer_id, order_count, last_order_date
FROM customer_summary
WHERE customer_type = 'premium'     -- 先过滤
  AND last_order_date >= '2024-01-01'
ORDER BY order_count DESC
LIMIT 100;  -- 在显示限制内

-- 策略2：时间窗口分页
SELECT order_id, customer_id, amount
FROM orders
WHERE order_date >= '2024-06-01 00:00:00'
  AND order_date < '2024-06-01 06:00:00'  -- 6小时窗口
ORDER BY order_date
LIMIT 1000;

-- 策略3：分类查看
SELECT product_id, product_name, price
FROM products
WHERE category = 'electronics'  -- 单一类别
ORDER BY price DESC
LIMIT 500;
```

#### **💻 编程接口分页策略**

适用于：JDBC、Python SDK等客户端（无硬性行数限制）

```sql
-- 策略1：基于游标的分页（推荐）
-- 第一页
SELECT customer_id, order_id, order_date, amount
FROM orders 
WHERE customer_id >= 0  -- 起始点
ORDER BY customer_id, order_id
LIMIT 1000;

-- 下一页（基于上一页的最后一条记录）
SELECT customer_id, order_id, order_date, amount
FROM orders 
WHERE customer_id > :last_customer_id  -- 游标位置
   OR (customer_id = :last_customer_id AND order_id > :last_order_id)
ORDER BY customer_id, order_id
LIMIT 1000;

-- 策略2：范围分页
-- 第一批：ID 0-9999
SELECT * FROM large_table 
WHERE id BETWEEN 0 AND 9999
ORDER BY id;

-- 第二批：ID 10000-19999
SELECT * FROM large_table 
WHERE id BETWEEN 10000 AND 19999
ORDER BY id;

-- 策略3：时间分区分页
-- 处理2024年6月的数据，按天分批
SELECT * FROM orders 
WHERE order_date >= '2024-06-01'
  AND order_date < '2024-06-02'
ORDER BY order_id;
```

#### **🔄 流式处理策略**

适用于：大数据ETL、数据导出场景

```sql
-- 策略1：分批流式处理
-- Python伪代码示例
"""
batch_size = 50000
offset = 0
while True:
    sql = f'''
    SELECT * FROM large_table 
    WHERE process_date = '2024-06-01'
    ORDER BY id 
    LIMIT {batch_size} OFFSET {offset}
    '''
    rows = execute_query(sql)
    if not rows:
        break
    process_batch(rows)
    offset += batch_size
"""

-- 策略2：条件迭代处理  
-- 适用于有序主键的表
"""
last_id = 0
batch_size = 50000
while True:
    sql = f'''
    SELECT * FROM large_table 
    WHERE id > {last_id}
    ORDER BY id 
    LIMIT {batch_size}
    '''
    rows = execute_query(sql)
    if not rows:
        break
    process_batch(rows)
    last_id = rows[-1]['id']
"""
```

### 性能调优建议

#### 1. 索引选择策略

* **高基数等值查询**：使用BLOOMFILTER索引
* **文本搜索需求**：使用INVERTED索引，选择合适的分析器
* **向量相似性搜索**：使用VECTOR索引，调整ef\_construction和M参数

#### 2. 构建策略

* **大表分区构建**：分批构建索引，避免单次处理过多数据
* **业务低峰期构建**：BUILD INDEX是同步操作，消耗计算资源
* **监控构建进度**：通过Job Profile查看构建状态

#### 3. 查询优化

```sql
-- 推荐：分区裁剪 + 索引过滤
SELECT *
FROM partitioned_table
WHERE partition_date >= '2024-06-01'  -- 分区裁剪
  AND category = 'electronics'        -- 布隆过滤器索引
  AND match_any(description, '手机', map('analyzer', 'chinese'));  -- 倒排索引

-- 避免：在索引列上使用函数
-- 错误示例
WHERE UPPER(category) = 'ELECTRONICS'  -- 无法利用索引

-- 正确示例
WHERE category = 'electronics'  -- 可以利用索引
```

***

## 最佳实践

### 查询编写建议

1. **明确指定列名**：避免使用`SELECT *`，明确指定需要的列
2. **合理使用索引**：为高频查询的过滤条件创建适当的索引
3. **优化JOIN顺序**：将小表放在JOIN的右侧，使用MAPJOIN提示
4. **使用分区裁剪**：在WHERE条件中直接使用分区字段
5. **避免函数包装分区字段**：不要对分区字段使用函数
6. **了解工具限制**：根据使用的客户端选择合适的查询策略

### 数据类型选择建议

1. **半结构化数据优先选择JSON**：性能优于STRING存储
2. **时间数据根据场景选择TIMESTAMP\_LTZ或TIMESTAMP\_NTZ**
3. **向量数据使用VECTOR类型**：获得原生性能优化
4. **大文本数据考虑全文搜索需求**：可配合相应的搜索功能使用
5. **理解NULL值显示特性**：数值和时间类型NULL有特殊显示格式

### 索引最佳实践

1. **合理选择索引类型**：根据查询模式选择合适的索引
2. **避免过度索引**：索引会增加存储成本和写入开销
3. **定期维护索引**：监控索引使用情况和性能影响
4. **测试验证效果**：创建索引后验证查询性能提升
5. **考虑数据特征**：高基数列适合布隆过滤器，文本列适合倒排索引

### 错误处理建议

1. **使用TRY\_CAST进行安全类型转换**
2. **检查转换结果是否为"nan**"
3. **为窗口函数的NULL结果提供合适的默认值处理**
4. **在数据质量检查中识别和处理异常值**

### 工具链选择建议

| 场景       | 推荐工具            | 注意事项        | 优化策略             |
| -------- | --------------- | ----------- | ---------------- |
| **数据探索** | Web Studio      | 10000行显示限制  | 添加过滤条件，专注分析逻辑    |
| **应用开发** | JDBC/Python SDK | 内存和网络限制     | 分批处理，合理设置批次大小    |
| **批量处理** | 编程接口            | 避免一次性加载大数据集 | 实现分批处理逻辑         |
| **报表展示** | BI工具            | 各工具限制不同     | 了解具体工具限制，设计合适数据源 |
| **性能测试** | 多工具对比           | 在真实环境验证     | 测试不同工具的实际表现      |

***

## 常见问题

### Q: 是否支持递归CTE（WITH RECURSIVE）？

A: 当前版本不支持递归CTE语法。对于层次化数据处理，可以使用多级JOIN或自连接方式：

```sql
-- 替代方案：使用多级JOIN处理层次数据
WITH level_1 AS (
    SELECT employee_id, employee_name, 1 as level
    FROM employees WHERE manager_id IS NULL
),
level_2 AS (
    SELECT e.employee_id, e.employee_name, 2 as level
    FROM employees e
    JOIN level_1 l1 ON e.manager_id = l1.employee_id
)
SELECT * FROM level_1
UNION ALL
SELECT * FROM level_2;
```

### Q: 如何查询历史版本数据？

A: 当前建议使用时间字段进行历史数据查询：

```sql
-- 使用创建时间字段查询历史数据
SELECT * FROM orders 
WHERE created_time >= '2024-06-01 00:00:00'
  AND created_time <= '2024-06-01 23:59:59';

-- 查询相对时间的数据
SELECT * FROM orders 
WHERE created_time >= CURRENT_TIMESTAMP() - INTERVAL '1' HOUR;
```

### Q: 为什么类型转换失败时返回"nan"而不是NULL？

A: Lakehouse采用更宽松的类型转换策略，转换失败时返回特殊值"nan"。可以使用以下方式进行安全转换：

```sql
-- 检查转换是否成功
SELECT 
    CASE 
        WHEN TRY_CAST(column AS INT) IS NOT NULL 
             AND CAST(TRY_CAST(column AS INT) AS STRING) != 'nan'
        THEN TRY_CAST(column AS INT)
        ELSE 0  -- 或其他默认值
    END as safe_converted_value
FROM table_name;
```

### Q: 窗口函数中的NULL值为什么显示为特殊格式？

A: 这是Lakehouse中数值类型和时间类型NULL值的特殊显示方式：

```sql
-- 数值类型NULL显示为"nan"，时间类型NULL显示为"NaT"
SELECT 
    LAG(customer_id) OVER (...) as prev_id,      -- 显示为"nan"
    LAG(timestamp_column) OVER (...) as prev_time, -- 显示为"NaT"
    CASE 
        WHEN LAG(timestamp_column) OVER (...) IS NULL   -- IS NULL判断仍然有效
        THEN 'No Previous Value'
        ELSE 'Has Previous Value'
    END as status
FROM table_name;
```

### Q: 如何迁移Spark中的regexp\_like函数？

A: Lakehouse不支持regexp\_like函数，可以使用以下替代方案：

```sql
-- 替代方案1：使用LIKE
WHERE column_name LIKE '%pattern%'

-- 替代方案2：使用regexp_extract检查是否有匹配
WHERE regexp_extract(column_name, 'pattern', 0) != ''

-- 替代方案3：组合多个条件
WHERE column_name LIKE '%pattern1%' OR column_name LIKE '%pattern2%'
```

### Q: LATERAL VIEW explode语法不支持怎么办？

A: 直接使用explode函数，无需LATERAL VIEW：

```sql
-- Spark语法
-- SELECT id, item FROM table LATERAL VIEW explode(array_column) AS item;

-- Lakehouse语法
SELECT id, explode(array_column) as item FROM table;
```

### Q: 哪些索引支持BUILD INDEX？

A: 只有INVERTED索引和VECTOR索引支持BUILD INDEX命令：

```sql
-- 支持BUILD INDEX
BUILD INDEX inverted_idx ON table_name;   -- 倒排索引
BUILD INDEX vector_idx ON table_name;     -- 向量索引

-- 不支持BUILD INDEX
-- BUILD INDEX bloom_idx ON table_name;   -- 布隆过滤器索引不支持
```

布隆过滤器索引只对新写入的数据生效，如需对已有数据生效，需要重写数据。

### Q: Web UI显示只有10000行，但我的数据有更多，如何查看全部？

A: 这是Web UI的显示限制，不是数据库的限制。建议：

```sql
-- Web UI策略：添加过滤条件
SELECT * FROM large_table 
WHERE category = 'electronics'  -- 先过滤
  AND created_date >= '2024-06-01'
LIMIT 1000;

-- 或使用WEB UI的全量下载功能下载后再查看

-- 或使用编程接口处理全量数据
-- Python示例：
"""
import clickzetta
conn = clickzetta.connect(...)
cursor = conn.cursor()
cursor.execute("SELECT * FROM large_table")
for row in cursor.fetchall():  -- 可处理超过10000行
    process(row)
"""
```

### Q: 不同工具的查询限制如何确认？

A: 建议在实际使用前测试：

1. **Web UI**：已知限制10000行
2. **JDBC客户端**：通过简单查询测试实际限制
3. **Python SDK**：查阅官方文档或测试验证
4. **BI工具**：查阅工具文档或联系厂商
5. **自定义应用**：在开发环境中进行压力测试

### Q: OFFSET功能有限制吗？

A: 经过实际验证，Lakehouse的OFFSET功能没有硬性限制：

```sql
-- ✅ 这些查询都可以正常执行
SELECT * FROM table ORDER BY id LIMIT 10 OFFSET 10000;   -- 正常
SELECT * FROM table ORDER BY id LIMIT 10 OFFSET 15000;   -- 正常
SELECT * FROM table ORDER BY id LIMIT 10 OFFSET 50000;   -- 正常

-- 限制主要来自：
-- 1. 使用的客户端工具的显示限制
-- 2. 网络传输和内存的实际约束
-- 3. 查询性能考虑（深度分页性能较差）
```

### Q: 索引的IF NOT EXISTS语法有什么特殊行为？

A: 语法完全支持，但当前实现有些特殊性：

```sql
-- ✅ 语法支持
CREATE BLOOMFILTER INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);
CREATE INVERTED INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);
CREATE VECTOR INDEX IF NOT EXISTS idx_name ON TABLE table_name(column);

-- ⚠️ 当前行为：在同一列创建相同类型的重复索引时仍可能报错
-- 这表明语法解析正确，但逻辑检查还在持续完善中
```

建议在生产环境中谨慎使用，必要时先检查索引是否已存在。

***

## 总结

云器Lakehouse作为现代化的数据湖解决方案，在保持SQL标准兼容性的同时，为大数据分析和AI应用提供了强大的扩展能力。通过本文档的学习，您应该能够：

### 🎯 **掌握的核心技能**

* **标准SQL查询**：熟练使用SELECT、JOIN、窗口函数等基础功能
* **现代数据类型**：充分利用JSON、VECTOR、ARRAY等复杂数据类型
* **性能优化**：通过索引、分区、查询提示等方式提升查询效率
* **全文搜索**：使用倒排索引进行智能文本检索
* **向量搜索**：支持AI/ML场景的相似性搜索需求
* **工具链认知**：了解不同客户端工具的限制和最佳实践
* **NULL值处理**：理解数值和时间类型NULL值的特殊显示格式

### 🚀 **进阶发展建议**

1. **深入索引优化**：根据业务场景选择合适的索引策略
2. **分区表设计**：掌握分区表的创建和查询优化技巧
3. **数据管道构建**：结合动态表、流处理等高级功能
4. **AI/ML集成**：探索向量搜索和知识图谱应用
5. **多工具协作**：根据不同场景选择最适合的查询工具

### 🔑 **重要认知**

* **工具限制 ≠ 系统限制**：始终区分客户端限制和数据库引擎能力
* **策略选择**：根据使用的工具选择合适的查询和分页策略
* **性能权衡**：在功能需求和性能表现之间找到最佳平衡点
* **数据类型理解**：掌握NULL值显示特性，正确处理数据转换

### 💡 **持续学习**

* 关注云器官方文档更新，了解新功能特性
* 参与社区讨论，分享使用经验和最佳实践
* 定期回顾查询性能，持续优化数据处理流程
* 在实际项目中验证不同工具的表现，积累经验

### 🤝 **获取帮助**

如果在使用过程中遇到问题，建议：

1. 首先查阅本文档的"常见问题"部分
2. 参考官方技术文档获取详细说明
3. 在实际环境中验证工具的限制和能力
4. 联系技术支持团队获取专业协助

云器Lakehouse将持续发展，我们期待您在数据分析和AI探索的旅程中取得更大成功！

***

## 参考资源

* [Lakehouse SQL函数参考](https://yunqi.tech/documents/SUMMARY)
* [数据类型详细说明](https://yunqi.tech/documents/datatype-conversion)
* [JSON数据类型文档](https://yunqi.tech/documents/json_analyze)
* [向量搜索功能文档](https://yunqi.tech/documents/vector-search)
* [全文搜索功能文档](https://yunqi.tech/documents/inverted-index)
* [布隆过滤器索引文档](https://yunqi.tech/documents/CREATE-BLOOMFILTER-INDEX)
* [倒排索引文档](https://yunqi.tech/documents/create-inverted-index)
* [向量索引文档](https://yunqi.tech/documents/create-vector-index)
* [索引构建文档](https://yunqi.tech/documents/build-inverted-index)
* [性能优化指南](https://yunqi.tech/documents/analytics_cluster_best_practices)
* [JDBC使用文档](https://yunqi.tech/documents/java_reference/jdbc)
* [Python SDK文档](https://yunqi.tech/documents/python_reference/connector)
* [试用账号限制说明](https://yunqi.tech/documents/trial-account-quotas-and-limits)

***

**注意**：本文档基于Lakehouse 2025年6月的产品文档整理，建议定期查看官方文档获取最新更新。在生产环境中使用前，请务必在测试环境中验证所有操作的正确性和性能影响。

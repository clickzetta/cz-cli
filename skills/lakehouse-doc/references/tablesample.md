# TABLESAMPLE - 数据采样功能

## 概述

TABLESAMPLE 是云器 Lakehouse 平台提供的高效数据采样方法，支持基于概率或固定行数的随机采样。通过两种不同的采样策略（SYSTEM 和 ROW），可以在性能和精度之间灵活平衡，满足从快速数据探索到精确统计分析的各种需求。

### 核心特性

* **灵活的采样方式**：支持百分比采样和固定行数采样
* **双重采样策略**：提供文件级（SYSTEM）和行级（ROW）两种模式
* **高性能设计**：SYSTEM 模式针对大数据场景优化
* **精确控制**：ROW 模式提供精确的随机采样结果

### 典型使用场景

| 场景       | 推荐模式   | 说明             |
| -------- | ------ | -------------- |
| 快速数据预览   | SYSTEM | 高性能，适合大表快速浏览   |
| 数据质量检查   | SYSTEM | 快速抽样验证数据质量     |
| 机器学习训练集  | ROW    | 精确随机采样，保证样本代表性 |
| 统计分析     | ROW    | 精确的概率采样，符合统计要求 |
| 开发测试数据生成 | ROW    | 生成小规模测试数据集     |
| 大规模数据分析  | SYSTEM | 百万级以上数据的高效采样   |

***

## 语法

```sql
SELECT <column_list>
FROM <table_name>
TABLESAMPLE [ROW | SYSTEM] ( { <percentage> | <num> ROWS } )
[ LIMIT <n> ]
[ ...其他子句... ]
```

### 参数说明

#### 采样类型

| 类型         | 描述                             | 适用场景                           | 性能         |
| ---------- | ------------------------------ | ------------------------------ | ---------- |
| **ROW**    | **行级随机采样** - 逐行独立判断是否采样，结果行数精准 | • 小到中型数据集（< 100万行）• 需要精确随机性的场景 | 较慢，需要扫描所有行 |
| **SYSTEM** | **文件级随机采样** - 按存储文件块随机筛选，性能更高  | • 大型数据集（> 100万行）<br>• 快速数据探索       | 极快，只读取部分文件 |
| **默认**     | 未指定时自动使用 SYSTEM 模式             | 一般用途                           | 高性能        |

#### 采样量指定

| 格式             | 描述              | 示例                | 说明        |
| -------------- | --------------- | ----------------- | --------- |
| `<percentage>` | 按百分比采样，范围 0-100 | `30` 表示采样 30%     | 实际行数可能有波动 |
| `<num> ROWS`   | 指定精确采样行数        | `5 ROWS` 表示采样 5 行 | ROW 模式更精确 |

⚠️ **重要提示**：

* 百分比采样在 SYSTEM 模式下可能不够精确（尤其是小数据集）
* 建议在查询中添加 `LIMIT` 子句以优化性能
* 采样结果是随机的，每次执行可能返回不同的数据

***

## 使用示例

### 准备测试数据

```sql
-- 创建测试视图
CREATE OR REPLACE VIEW test(id, name) AS
VALUES ( 1, 'Lisa'),
       ( 2, 'Mary'),
       ( 3, 'Evan'),
       ( 4, 'Fred'),
       ( 5, 'Alex'),
       ( 6, 'Mark'),
       ( 7, 'Lily'),
       ( 8, 'Lucy'),
       ( 9, 'Eric'),
       (10, 'Adam');

-- 创建测试表
CREATE TABLE employee (id INT, name STRING);

INSERT INTO employee VALUES 
       ( 1, 'Lisa'),
       ( 2, 'Mary'),
       ( 3, 'Evan'),
       ( 4, 'Fred'),
       ( 5, 'Alex'),
       ( 6, 'Mark'),
       ( 7, 'Lily'),
       ( 8, 'Lucy'),
       ( 9, 'Eric'),
       (10, 'Adam');
```

### 基础采样示例

#### 1. 百分比采样（SYSTEM 模式）

```sql
-- 随机抽取 30% 的数据（默认 SYSTEM 模式）
SELECT * FROM test TABLESAMPLE (30) LIMIT 50;

-- 结果：约返回 3 行数据（30% × 10 行）
-- 注意：小数据集上 SYSTEM 模式可能返回所有数据或不精确
```

#### 2. 固定行数采样（SYSTEM 模式）

```sql
-- 随机抽取 5 行数据
SELECT * FROM test TABLESAMPLE (5 ROWS) LIMIT 50;

-- 结果：约返回 5 行数据
-- 示例输出：
-- | id | name |
-- |----|------|
-- |  1 | Lisa |
-- |  2 | Mary |
-- |  3 | Evan |
-- |  4 | Fred |
-- |  5 | Alex |
```

#### 3. 精确行级采样（ROW 模式）

```sql
-- 精确随机抽取 5 行（ROW 模式）
SELECT * FROM employee TABLESAMPLE ROW (5 ROWS) LIMIT 50;

-- 结果：精确返回 5 行随机数据
-- 示例输出：
-- | id | name |
-- |----|------|
-- | 10 | Adam |
-- |  1 | Lisa |
-- |  8 | Lucy |
-- |  6 | Mark |
-- |  3 | Evan |
```

### 实际应用场景

#### 场景 1：快速数据预览（推荐 SYSTEM）

```sql
-- 从百万级订单表中快速查看样本数据
SELECT 
    order_id,
    customer_id,
    order_date,
    total_amount
FROM orders 
TABLESAMPLE SYSTEM (1)  -- 1% 采样，性能极高
LIMIT 100;

-- 适用：快速了解数据结构和内容
```

#### 场景 2：数据质量检查（推荐 SYSTEM）

< 0 OR stock_quantity < 0
LIMIT 50;

-- 适用：快速发现数据质量问题
```

#### 场景 3：生成机器学习训练集（推荐 ROW）

```sql
-- 从用户行为表中随机抽取训练样本
SELECT 
    user_id,
    behavior_type,
    item_id,
    timestamp
FROM user_behavior 
TABLESAMPLE ROW (20)  -- 精确 20% 随机采样
LIMIT 1000000;

-- 适用：保证样本的随机性和代表性
```

#### 场景 4：统计分析采样（推荐 ROW）

```sql
-- 估算平均订单金额
SELECT 
    AVG(total_amount) as avg_order_amount,
    COUNT(*) as sample_count
FROM large_orders_table 
TABLESAMPLE ROW (5)  -- 5% 精确采样
LIMIT 1000000;

-- 适用：需要统计学上严格的随机采样
```

#### 场景 5：开发环境测试数据

```sql
-- 生成小规模测试数据
CREATE TABLE test_customers AS
SELECT * 
FROM production_customers 
TABLESAMPLE ROW (1000 ROWS)  -- 精确 1000 行
LIMIT 1000;

-- 适用：开发和测试环境数据准备
```

### 进阶用法

#### 结合 WHERE 条件

```sql
-- TABLESAMPLE 必须紧跟表名，然后才能使用 WHERE 条件
SELECT * 
FROM orders 
TABLESAMPLE SYSTEM (10)
WHERE order_date >

#### 结合聚合分析

```sql
-- 在采样数据上进行聚合分析
SELECT 
    DATE_TRUNC('month', order_date) as month,
    COUNT(*) as order_count,
    AVG(total_amount) as avg_amount
FROM large_orders
TABLESAMPLE SYSTEM (5)
GROUP BY DATE_TRUNC('month', order_date)
ORDER BY month
LIMIT 50;
```

#### 多表采样 JOIN

```sql
-- 对多个大表采样后 JOIN
SELECT 
    o.order_id,
    c.customer_name,
    o.total_amount
FROM orders o
TABLESAMPLE SYSTEM (10)
JOIN customers c
TABLESAMPLE SYSTEM (10)
ON o.customer_id = c.customer_id
LIMIT 100;
```

***

## 采样策略深度对比

### SYSTEM 模式详解

**工作原理**：

* 在文件/数据块级别进行随机选择
* 如果一个文件被选中，则返回该文件中的所有行
* 不读取未被选中的文件，性能极高

**性能特点**：

* ⚡ **极快**：只读取部分文件，I/O 开销低
* 📊 **适合大数据**：数据量越大，性能优势越明显
* 💾 **内存友好**：不需要缓存所有数据

**适用场景**：

* ✅ 大型表（百万行以上）
* ✅ 快速数据探索和预览
* ✅ 对精度要求不高的场景
* ✅ 数据质量检查

**注意事项**：

* ⚠️ 小数据集可能不精确（可能返回全部或没有数据）
* ⚠️ 如果数据存储倾斜，采样可能有偏差
* ⚠️ 结果行数可能与预期有较大差异

### ROW 模式详解

**工作原理**：

* 逐行评估是否采样（基于伪随机算法）
* 每行都有独立的被选中概率
* 需要扫描所有数据行

**性能特点**：

* 🐢 **较慢**：需要读取和评估所有行
* 🎯 **精确**：结果行数接近预期
* 💡 **统计严格**：符合随机采样的统计学要求

**适用场景**：

* ✅ 中小型表（百万行以下）
* ✅ 机器学习训练集生成
* ✅ 统计分析和科学计算
* ✅ 需要精确随机性的场景

**注意事项**：

* ⚠️ 大表性能开销较大
* ⚠️ 仍需要扫描整表
* ✅ 结果行数更可预测

### 性能对比

| 数据规模      | SYSTEM 模式 | ROW 模式  | 推荐             |
| --------- | --------- | ------- | -------------- |
| < 1 万行    | \~10ms    | \~15ms  | ROW（精确性更重要）    |
| 1-10 万行   | \~50ms    | \~200ms | ROW 或 SYSTEM   |
| 10-100 万行 | \~100ms   | \~2s    | SYSTEM（性能差异明显） |
| > 100 万行  | ~200ms   | ~10s+  | SYSTEM（性能优势巨大） |

*注：实际性能取决于硬件、数据分布等因素*

***

## 最佳实践

### 1. 如何选择采样模式

< 100万行？
│  ├─ 是 → 需要精确随机性？
│  │     ├─ 是 → 使用 ROW 模式
│  │     └─ 否 → 使用 SYSTEM 模式（更快）
│  └─ 否 → 使用 SYSTEM 模式（性能优先）
```

### 2. 性能优化建议

#### ✅ 推荐做法

```sql
-- 1. 始终添加 LIMIT 子句
SELECT * FROM large_table 
TABLESAMPLE (10) 
LIMIT 1000;  -- ✅ 限制最终返回行数

-- 2. 在大表上优先使用 SYSTEM
SELECT * FROM billion_rows_table 
TABLESAMPLE SYSTEM (1)  -- ✅ 1% 采样已足够
LIMIT 10000;

-- 3. 先采样再 JOIN（减少 JOIN 数据量）
SELECT a.*, b.*
FROM (
    SELECT * FROM large_table_a 
    TABLESAMPLE (5) 
    LIMIT 100000
) a
JOIN large_table_b b ON a.id = b.id
LIMIT 1000;
```

#### ❌ 避免的做法

```sql
-- 1. 在小表上使用 SYSTEM 期望精确结果
SELECT * FROM small_table_10_rows 
TABLESAMPLE SYSTEM (30);  -- ❌ 可能返回 0 行或 10 行

-- 2. 在大表上使用 ROW 不加 LIMIT
SELECT * FROM billion_rows_table 
TABLESAMPLE ROW (10);  -- ❌ 性能极差，可能返回 1 亿行

-- 3. 过度采样（接近 100%）
SELECT * FROM large_table 
TABLESAMPLE (95);  -- ❌ 接近全表扫描，失去采样意义
```

### 3. 采样精度建议

| 需求     | 推荐采样比例    | 说明            |
| ------ | --------- | ------------- |
| 快速预览   | 0.1% - 1% | 足够了解数据结构      |
| 数据质量检查 | 5% - 10%  | 平衡性能和覆盖率      |
| 统计估算   | 10% - 20% | 保证统计显著性       |
| 机器学习训练 | 20% - 50% | 根据数据量和模型复杂度调整 |

### 4. 常见问题解答

**Q1: 采样比例超过 100% 会怎样**？

```sql
SELECT * FROM test TABLESAMPLE (150) LIMIT 50;
-- A: 会报错！ClickZetta 要求采样比例必须在 0-100 之间
-- 错误信息: tablesample percentage number should be greater than 0 and less than 100
```

**Q2: 采样行数超过表总行数会怎样**？

```sql
SELECT * FROM test TABLESAMPLE (100 ROWS) LIMIT 50;  -- 表只有 10 行
-- A: 会返回全表数据（10 行）
```

**Q3: 空表采样会返回什么**？

```sql
SELECT * FROM empty_table TABLESAMPLE (50) LIMIT 50;
-- A: 返回空结果集，不会报错
```

**Q4: 视图和表的采样有差异吗**？

```sql
-- 都支持，但视图可能性能稍差（需要先物化）
SELECT * FROM my_view TABLESAMPLE ROW (10) LIMIT 50;
```

**Q5: 如何获得可重复的采样结果**？

```sql
-- TABLESAMPLE 不支持 SEED，如需可重复采样：
SELECT * FROM (
    SELECT *, ROW_NUMBER() OVER (ORDER BY id) as rn
    FROM my_table
) WHERE rn % 10 = 0  -- 每 10 行取 1 行
LIMIT 50;
```

***

## 限制和注意事项

### 使用限制

1. **不支持的场景**
   * ❌ 不支持在子查询的 WHERE 子句中使用
   * ❌ 不支持在 CTE (WITH 子句) 定义中使用
   * ❌ 不支持在物化视图定义中使用

2. **语法限制**
   * ⚠️ 必须在 FROM 子句中紧跟表名使用
   * ⚠️ TABLESAMPLE 必须在 WHERE 子句之前
   * ⚠️ 不能与 `FOR UPDATE` 一起使用
   * ⚠️ 百分比采样的范围必须在 0-100 之间（不包括0和100）

3. **性能注意事项**
   * ⚠️ ROW 模式在超大表（> 1000万行）上可能非常慢
   * ⚠️ 即使采样 1%，ROW 模式也需要扫描全表

### 数据一致性

* 🔄 **非确定性**：每次执行返回不同的结果
* 📊 **统计偏差**：SYSTEM 模式在数据分布不均时可能有偏差
* ⏱️ **时效性**：采样时看到的是当时的数据快照

### 最佳实践总结

| 场景    | 数据量    | 推荐模式   | 采样比例   | LIMIT      |
| ----- | ------ | ------ | ------ | ---------- |
| 数据预览  | 任意     | SYSTEM | 1-5%   | 100-1000   |
| 质量检查  | 任意     | SYSTEM | 5-10%  | 1000-10000 |
| 统计分析  | < 100万 | ROW    | 10-20% | 适当         |
| 统计分析  | > 100万 | SYSTEM | 5-10%  | 适当         |
| ML训练集 | < 100万 | ROW    | 20-50% | 适当         |
| ML训练集 | > 100万 | SYSTEM | 10-30% | 适当         |

***

## 相关参考

* **数据探索**：结合 [DESCRIBE](DESCTABLE.md) 和 [SHOW](show.md) 命令了解表结构
* **性能优化**：配合分区表和 `WHERE` 条件提升采样效率
* **数据分析**：与 [聚合函数、窗口函数](window-function-summary.md) 组合使用

^

# 编写SQL对数据进行清洗

在数据分析和数据挖掘的过程中，数据清洗和预处理是至关重要的一步。本文将介绍各种常用的Lakehouse SQL数据清洗方法，帮助您更好地理解和应用这些方法。

## 构建环境

导航到Lakehouse Studio开发->任务，单击“+”新建一个SQL任务（以下两种方式都在同一个任务里实现）。

:-: ![](.topwrite/assets/image_1736148597217.png =470)

^

新建两个SQL任务（如下图所示），然后从[GitHub获取代码](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/QuickStart_SQL_DataClean)下载SQL代码并复制到两个任务中。

然后逐一运行每个SQL，观察结果。

:-: ![](.topwrite/assets/image_1736402851987.png =471)

以下是各个步骤的说明。

## 构建实验用的Schema和计算集群

```SQL
-- Data_Clean virtual cluster
CREATE VCLUSTER IF NOT EXISTS Data_Clean
   VCLUSTER_SIZE = XSMALL
   VCLUSTER_TYPE = GENERAL
   AUTO_SUSPEND_IN_SECOND = 60
   AUTO_RESUME = TRUE
   COMMENT  'Data_Clean VCLUSTER for test';

-- Use our VCLUSTER
USE VCLUSTER Data_Clean;

-- Create and Use SCHEMA
CREATE SCHEMA IF NOT EXISTS  Data_Clean;
USE SCHEMA Data_Clean;
```

> 注：计算集群的vcluster\_size参数同时支持以T-shirt size（XSMALL、SMALL、Large等）和以数字（1,2,4,16等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

## 将IDE中每个任务的Schema和集群设置为新创建的：

:-: ![](.topwrite/assets/image_1736403086331.png =508)

^

## 创建示例表并插入脏数据

首先，我们需要创建一个示例表，并插入一些包含脏数据的示例数据，以便在接下来的步骤中进行演示。

```SQL
-- 创建名为 "sales_data" 的示例表
CREATE TABLE sales_data (
    id INT,
    sale_date DATE,
    customer_id INT,
    product_id VARCHAR(50),
    quantity INT,
    price DECIMAL(10, 2),
    total_amount DECIMAL(10, 2),
    region VARCHAR(50)
);

-- 插入20行包含脏数据的示例数据
INSERT INTO sales_data (id, sale_date, customer_id, product_id, quantity, price, total_amount, region) VALUES
(1, '2025-01-01', 101, '201A', 5, 100.00, 500.00, 'North'),
(2, '2025-01-02', 102, '202', 3, 150.00, 450.00, 'East'),
(3, '2025-01-03', NULL, '203', 8, 200.00, 1600.00, 'South'), -- 缺失customer_id
(4, '2025-01-04', 104, '204', -10, 50.00, 500.00, 'West'), -- quantity负数
(5, '2025-01-05', 105, '201@#', 7, 75.00, 525.00, 'North'), -- product_id包含特殊字符
(6, '2025-01-06', 106, '202', 9, NULL, 1080.00, 'East'), -- 缺失price
(7, '2025-01-07', 107, '203', 4, 60.00, 240.00, 'South'),
(8, '2025-01-08', 108, '204', 6, 80.00, 480.00, ''), -- region为空
(9, '2025-01-09', 109, '201', 2, 110.00, 220.00, 'North'),
(10, '2025-01-10', 110, '202', 1, 130.00, 130.00, 'East'),
(11, '2025-01-11', 111, '203', 5, 140.00, 700.00, 'South'),
(12, '2025-01-12', 112, '204', 3, 70.00, 210.00, 'NULL'), -- region包含非法字符
(13, '2025-01-13', 113, '201', 8, 160.00, 1280.00, 'North'),
(14, '2025-01-14', 114, '202A', 6, 90.00, 540.00, 'East'), -- product_id包含特殊字符
(15, '2025-01-15', 115, '203', 7, 170.00, 1190.00, 'South'),
(16, '2025-01-16', 116, '204', 4, 180.00, 720.00, 'West'),
(17, '2025-01-17', 117, '201', 5, 85.00, 425.00, 'North'),
(18, '2025-01-18', 118, '202', 9, 190.00, 1710.00, 'East'),
(19, '2025-01-19', 119, '203', 2, 200.00, 400.00, 'South'),
(20, '2025-01-20', 120, '204', -1, 210.00, 210.00, 'West'); -- quantity负数
```

### 脏数据问题和处理方法说明

1. **缺失值**

   * **示例**: 第3行的`customer_id`缺失。
   * **问题**: 缺失值会导致分析不完整或错误。
   * **处理**: 使用`COALESCE`或`IFNULL`填充默认值，如`0`。

2. **负数值**

   * **示例**: 第4行和第20行的`quantity`为负数。
   * **问题**: 负数值在某些场景下是不合理的，如销售数量。
   * **处理**: 使用`CASE`语句将负数值转换为合理值。

3. **特殊字符**

   * **示例**: 第5行和第14行的`product_id`包含特殊字符。
   * **问题**: 特殊字符可能导致数据解析错误。
   * **处理**: 使用`REGEXP_REPLACE`移除特殊字符。

4. **缺失字段**

   * **示例**: 第6行的`price`缺失。
   * **问题**: 缺失字段会导致数据不完整。
   * **处理**: 使用`COALESCE`或`IFNULL`填充默认值。

5. **空字符串**

   * **示例**: 第8行的`region`为空。
   * **问题**: 空字符串会导致数据解析不准确。
   * **处理**: 使用`TRIM`函数处理空白值（如删除或替换）。

6. **非法字符**

   * **示例**: 第12行的`region`包含非法字符。
   * **问题**: 非法字符会导致数据解析错误。
   * **处理**: 使用`REGEXP_REPLACE`移除非法字符。

通过上述方法处理这些脏数据，可以显著提高数据质量，为后续的数据分析和挖掘提供更可靠的基础。

## 处理缺失值

### 说明

缺失值是数据清洗中常见的问题，它会导致数据分析结果不准确。可以使用 `COALESCE` 函数、`IFNULL` 函数或者 `CASE` 语句填充默认值或替换缺失值。在实际项目中，处理缺失值常用于确保关键字段不为空，以保证数据的完整性。

### 实现

```sql
-- 使用 COALESCE 填充默认值
SELECT id, sale_date, COALESCE(customer_id, 0) AS customer_id, product_id, quantity, price, COALESCE(total_amount, 0) AS total_amount, region FROM sales_data;

-- 使用 IFNULL 填充默认值
SELECT id, sale_date, IFNULL(customer_id, 0) AS customer_id, product_id, quantity, price, IFNULL(total_amount, 0) AS total_amount, region FROM sales_data;

-- 使用 CASE 语句处理缺失值
SELECT id, 
       CASE 
           WHEN sale_date IS NULL THEN '2025-01-01'
           ELSE sale_date
       END AS sale_date,
       customer_id, 
       product_id, 
       quantity, 
       price, 
       total_amount, 
       region 
FROM sales_data;

```

## 移除特殊字符

### 说明

特殊字符会影响数据的分析，可以使用 `REGEXP_REPLACE` 函数来移除这些字符。在实际项目中，移除特殊字符常用于清理文本字段中的噪声字符，使数据更加整洁和规范。

### 实现

```sql
-- 移除特殊字符
SELECT id, sale_date, customer_id, 
       REGEXP_REPLACE(product_id, '[^a-zA-Z0-9]', '') AS cleaned_product_id,
       quantity, 
       price, 
       total_amount, 
       region
FROM sales_data;
```

## 转换数据类型

### 说明

有时候需要将数据从一种类型转换为另一种类型，例如将字符串转换为日期类型。数据类型的转换能够保证数据的一致性和准确性。在实际项目中，常用于标准化数据格式，如日期、金额等。

### 实现

```sql
-- 将字符串转换为日期
SELECT id, CAST(sale_date AS DATE) AS sale_date, 
    customer_id, product_id, quantity, 
    CAST(price AS DECIMAL(10, 2)) AS price, 
    CAST(total_amount AS DECIMAL(10, 2)) AS total_amount, region 
FROM sales_data;
```

## 删除空格

### 说明

在数据清洗过程中，字符串前后的空格会导致数据分析结果不准确。我们可以使用 `TRIM` 函数删除空格。在实际项目中，删除空格常用于清理包含多余空格的文本字段。

### 实现

```sql
-- 删除空白值
SELECT id, 
       TRIM(sale_date) AS sale_date, 
       customer_id, 
       product_id, 
       quantity, 
       price, 
       total_amount, 
       TRIM(region) AS region
FROM sales_data;
```

## 转换大小写

### 说明

为了统一数据格式，可以将文本字段转换为小写或大写。在实际项目中，转换大小写常用于确保数据的一致性，例如在客户名称、产品名称等字段中。

### 实现

```sql
-- 将区域字段转换为小写
SELECT id, 
       sale_date, 
       customer_id, 
       product_id, 
       quantity, 
       price, 
       total_amount, 
       LOWER(region) AS region
FROM sales_data;
```

## 删除异常值

### 说明

异常值可能会影响数据分析的结果，使用 `DELETE` 语句可以删除这些记录。在实际项目中，删除异常值常用于剔除极端或错误的数据，以保证分析结果的准确性。

### 实现

< -5000;
```

## 去重

### 说明

在数据集中，重复记录会影响数据分析的准确性。我们可以使用 `DISTINCT` 或者 `ROW_NUMBER()` 函数来去除重复记录。在实际项目中，去重操作常用于合并多个数据源或清理历史数据时。

### 实现

```sql
-- 使用 DISTINCT 去重
SELECT DISTINCT customer_id, product_id, region FROM sales_data;

-- 使用 ROW_NUMBER() 去重
WITH RowNumCTE AS (
    SELECT *,
           ROW_NUMBER() OVER(PARTITION BY customer_id, product_id, region ORDER BY id) AS row_num
    FROM sales_data
)
SELECT id, sale_date, customer_id, product_id, quantity, price, total_amount, region
FROM RowNumCTE
WHERE row_num = 1;
```

## 数据分组和聚合

### 说明

通过分组和聚合，可以生成汇总报告，了解数据的整体情况。分组和聚合操作可以帮助我们发现数据中的模式和趋势。在实际项目中，常用于统计、分析数据，如计算销售总额、平均值等。

### 实现

```sql
-- 按区域分组计算总销售额
SELECT region, SUM(total_amount) AS total_sales FROM sales_data GROUP BY region;

-- 按产品分组计算总销售量
SELECT product_id, SUM(quantity) AS total_quantity FROM sales_data GROUP BY product_id;
```

## 数据筛选

### 说明

使用 `WHERE` 子句筛选出符合特定条件的数据。在实际项目中，数据筛选常用于提取感兴趣的数据子集，如筛选出高价值客户、特定时间段的销售数据等。

### 实现

```sql
-- 筛选出销售金额大于500的记录
SELECT * FROM sales_data WHERE total_amount >

## 数据排序

### 说明

排序可以帮助我们按特定顺序查看数据，发现数据中的模式和趋势。在实际项目中，排序常用于数据展示、报告生成等场景。

### 实现

```sql
-- 按销售金额排序
SELECT * FROM sales_data ORDER BY total_amount DESC;
```

## 合并列数据

### 说明

在某些情况下，我们需要将多个列的数据合并为一列。在实际项目中，合并列数据常用于生成综合信息字段，例如完整的地址、姓名等。

### 实现

```sql
-- 合并产品ID和区域字段
SELECT id,       sale_date,       customer_id,       product_id || '-' || region AS combined_field,       quantity,       price,       total_amountFROM sales_data;
```

## 合并数据

### 说明

使用 `UNION` 操作将多个结果集合并在一起，形成一个完整的结果集。在实际项目中，合并数据常用于将多个查询结果整合在一起，形成统一的分析数据集。

### 实现

```sql
-- 合并两个结果集
SELECT id, sale_date, customer_id, product_id, quantity, price, total_amount, region FROM sales_data
UNION
SELECT id, sale_date, customer_id, product_id, quantity, price, total_amount, region FROM another_sales_data;
```

通过以上的SQL数据清洗和预处理技术，您可以有效地处理和转换数据，为后续的数据分析和挖掘奠定坚实的基础。数据清洗不仅能提高数据质量，还能提升数据分析的准确性和可靠性。

## 数据清洗SQL函数列表

以下是常用的SQL数据清洗函数列表：

1. **处理缺失值**

   * [COALESCE()](sql_functions/scalar_functions/conditional_functions/coalesce.md): 用于将NULL值替换为指定的默认值。
   * [IFNULL()](ifnull.md): 类似于COALESCE()，用于将NULL值替换为指定的默认值。
   * `CASE`: 用于根据特定条件处理缺失值。

2. **移除特殊字符**

   * [REGEXP\_REPLACE()](sql_functions/scalar_functions/string_functions/regexp_extract.md): 用于使用正则表达式替换文本中的特殊字符。

3. **转换数据类型**

   * `CAST()`: 用于将数据从一种类型转换为另一种类型。

4. **删除空白值**

   * [TRIM()](sql_functions/scalar_functions/string_functions/trim.md): 用于删除字符串中的空白字符。

5. **转换大小写**

   * `LOWER()`: 将文本转换为小写。
   * [UPPER()](sql_functions/scalar_functions/string_functions/upper.md): 将文本转换为大写。

6. **删除异常值**

   * [DELETE](DELETE.md): 用于删除不符合条件的记录。

7. **去重**

   * [DISTINCT](query-syntax.md): 用于去除结果集中的重复行。
   * [ROW\_NUMBER()](sql_functions/window_functions/row_number.md): 用于对结果集中的每一行分配唯一的行号。

8. **数据分组和聚合**

   * [GROUP BY](query-syntax.md): 用于将结果集按一个或多个列进行分组。
   * [SUM()](query-syntax.md): 用于计算指定列的总和。
   * [AVG()](query-syntax.md): 用于计算指定列的平均值。
   * [COUNT()](query-syntax.md): 用于计算指定列的记录数。

9. **数据筛选**

   * [WHERE](query-syntax.md): 用于筛选符合特定条件的记录。

10. **数据排序**

    * [ORDER BY](query-syntax.md): 用于对结果集进行排序。

11. **数据联合**

    * [JOIN](JOIN.md): 用于将两个或多个表联合起来，形成一个完整的数据视图。

12. **合并列数据**

    * [CONCAT()](sql_functions/scalar_functions/string_functions/concat.md): 用于将多个列的数据合并为一个列。

13. **合并数据**

    * [UNION](query-syntax.md): 用于将多个结果集合并在一起。

^

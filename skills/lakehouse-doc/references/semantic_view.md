# 语义视图（Semantic View）

## 概述

语义视图是云器 Lakehouse 中的一种架构级逻辑数据模型对象，用于弥合业务用户描述数据的方式与数据在数据平台中实际存储方式之间的差距。

如果没有语义视图，不同的报表和应用中可能存在不一致的计算方式，导致偏差结果。语义视图作为面向业务的抽象层，解决了以下常见问题：

* **对于数据分析**：语义视图提供了统一的指标和维度定义，使业务用户无需编写复杂的 JOIN 语句即可查询跨表数据，显著降低了 SQL 编写门槛。
* **对于数据治理**：语义视图以声明式方式集中管理表关系、维度和指标的定义，确保组织内部所有利益相关方——从数据分析师到业务用户——使用的都是相同的数据口径。

***

## 语义视图中的概念

语义视图由以下核心组件构成：

**逻辑表（TABLES**）：在语义视图中，您定义的逻辑表通常对应业务实体，如客户、订单或商品明细。每个逻辑表映射到一张物理表，并通过主键和外键声明表间关系。您可以通过外键定义逻辑表之间的连接关系，从而实现跨实体的数据分析——就像在数据库中连接物理表一样，但无需在查询时手动编写 JOIN。

**维度（DIMENSIONS**）：维度是分类属性，为指标提供上下文含义。它们通过将数据分组为有意义的类别来回答"谁"、"什么"、"哪里"和"何时"等问题，例如订单日期、客户名称或订单年份。

**指标（METRICS**）：指标是通过对列进行聚合计算（如 `SUM`、`AVG`、`COUNT`）得出的量化业务度量。它们将原始数据转化为有意义的业务指标，例如"客户总数"或"平均订单价值"。指标代表了报表和仪表盘中驱动业务决策的 KPI。

**过滤器（FILTERS**）：过滤器是预定义的、可重用的过滤条件，用于在语义视图中封装常用的业务筛选逻辑。

***

## 创建语义视图

### 语法

```sql
CREATE SEMANTIC VIEW <视图名称>
TABLES (
    <逻辑表定义> [ , ... ]
)
[ FILTERS (
    <过滤器定义> [ , ... ]
) ]
DIMENSIONS (
    <维度定义> [ , ... ]
)
METRICS (
    <指标定义> [ , ... ]
)
[ COMMENT = '<视图说明>' ]
;
```

其中，各子句的定义语法如下：

#### 逻辑表定义

```sql
<表别名> AS <架构名>.<物理表名>
    PRIMARY KEY ( <列名> [ , ... ] )
    [ FOREIGN KEY ( <列名> ) REFERENCES <其他逻辑表别名> ]
    [ WITH SYNONYMS ( '<同义词>' [ , ... ] ) ]
    [ COMMENT = '<说明>' ]
```

#### 过滤器定义

```sql
<逻辑表别名>.<过滤器名> AS <布尔表达式>
```

#### 维度定义

```sql
{ <逻辑表别名>.<维度名> | <维度名> } AS <表达式>
    [ WITH SYNONYMS = ( '<同义词>' [ , ... ] ) ]
    [ is_unique = { true | false } ]
    [ is_time = { true | false } ]
    [ enum_values = [ <值1>, <值2>, ... ] ]
    [ COMMENT = '<说明>' ]
```

#### 指标定义

```sql
<逻辑表别名>.<指标名> AS <聚合表达式>
    [ COMMENT = '<说明>' ]
```

### 参数说明

**逻辑表定义参数**：

| 参数                                          | 说明                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------- |
| `<表别名> AS <架构名>.<物理表名>`                     | 为物理表指定一个逻辑别名。在后续的外键引用、维度和指标定义中，均使用此别名来引用逻辑表                         |
| `PRIMARY KEY ( <列名> [ , ... ] )`            | 指定逻辑表中作为主键的一列或多列。主键有助于确定表之间的关系类型（如一对多或一对一）                          |
| `FOREIGN KEY ( <列名> ) REFERENCES <其他逻辑表别名>` | 定义当前逻辑表与另一个逻辑表之间的外键关系。引用目标必须使用逻辑表别名（而非物理表名）。语义视图在查询时会根据此外键关系自动处理表连接 |
| `WITH SYNONYMS ( '<同义词>' )`                 | 为逻辑表定义同义词，增强可发现性                                                    |
| `COMMENT = '<说明>'`                          | 为逻辑表添加描述性注释                                                         |

**维度定义参数**：

| 参数                                       | 说明                                             |
| ---------------------------------------- | ---------------------------------------------- |
| `is_unique`                              | 标识该维度的值是否唯一。当设置为 `true` 时，表示该维度列中不包含重复值，例如客户名称 |
| `is_time`                                | 标识该维度是否为时间类型。当设置为 `true` 时，表示该维度代表时间属性，例如订单日期  |
| `enum_values`                            | 定义该维度允许的枚举值列表。这有助于约束维度的取值范围并提升查询准确性            |
| `WITH SYNONYMS = ( '<同义词1>', '<同义词2>' )` | 为维度定义一个或多个同义词，使用户可以使用不同的业务术语来引用同一个维度           |

**指标聚合函数**： `COUNT`、`AVG`、`SUM`、`MIN`、`MAX`

### 使用说明

* 在语义视图中，您必须至少定义一个维度或一个指标，即必须包含 `DIMENSIONS` 子句或 `METRICS` 子句。
* 在 `TABLES` 子句中，被外键引用的逻辑表必须先于引用它的表进行定义。例如，如果 `orders` 表的外键引用了 `customers` 表，则 `customers` 的定义必须出现在 `orders` 之前，或至少在同一 `TABLES` 子句中已被声明。
* 如果目标语义视图已存在，`CREATE SEMANTIC VIEW` 将报错。建议使用 `DROP SEMANTIC VIEW IF EXISTS` 语句先删除已有视图，以确保脚本的幂等性（可重复执行）。
* 维度和指标支持两种命名方式：**限定名称**（`<逻辑表别名>.<名称>`，如 `orders.order_date`）和**短名称**（直接使用名称，如 `order_date`）。当维度或指标名称在语义视图中唯一时，可以使用短名称；如果存在同名冲突，则必须使用限定名称。
* 维度支持将表达式作为定义，即**计算维度**。例如，`YEAR(o_orderdate)` 可从订单日期中提取年份，作为一个独立的维度使用。

### 示例

以下示例使用 TPC-H 数据集创建一个名为 `tpch_rev_analysis` 的语义视图，用于收入分析场景。该数据集包含客户、订单和订单明细等表，代表了一个简化的业务场景。

该语义视图定义了：

* 三个逻辑表（`orders`、`customers` 和 `line_items`），分别映射到 TPC-H 中的订单表、客户表和订单明细表。
* `orders` 和 `customers` 之间的外键关系（通过 `o_custkey`）。
* `line_items` 和 `orders` 之间的外键关系（通过 `l_orderkey`）。
* 用于分组和过滤的维度：客户名称、订单日期和订单年份。
* 量化的业务指标：客户总数和平均订单价值。

#### 基础语义视图

```sql
DROP SEMANTIC VIEW IF EXISTS tpch_rev_analysis;
CREATE SEMANTIC VIEW tpch_rev_analysis
TABLES (
    customers AS TPCH_SF1.CUSTOMER
        PRIMARY KEY (c_custkey)
        COMMENT = 'Main table for customer data',
    orders AS TPCH_SF1.ORDERS
        PRIMARY KEY (o_orderkey)
        FOREIGN KEY (o_custkey) REFERENCES customers
        WITH SYNONYMS ('sales orders')
        COMMENT = 'All orders table for the sales domain',
    line_items AS TPCH_SF1.LINEITEM
        PRIMARY KEY (l_orderkey, l_linenumber)
        FOREIGN KEY (l_orderkey) REFERENCES orders
        COMMENT = 'Line items in orders'
)
DIMENSIONS (
    customers.customer_name AS customers.c_name
        WITH SYNONYMS = ('customer name')
        COMMENT = 'Name of the customer',
    orders.order_date AS o_orderdate
        COMMENT = 'Date when the order was placed',
    orders.order_year AS YEAR(o_orderdate)
        COMMENT = 'Year when the order was placed'
)
METRICS (
    customers.customer_count AS COUNT(c_custkey)
        COMMENT = 'Count of number of customers',
    orders.order_average_value AS AVG(orders.o_totalprice)
        COMMENT = 'Average order value across all orders'
)
COMMENT = 'Semantic view for revenue analysis';
```

在上述示例中，`TABLES` 子句定义了三个逻辑表：一个包含 TPC-H 订单信息的 `orders` 表，一个包含客户信息的 `customers` 表，以及一个包含订单明细的 `line_items` 表。每个逻辑表通过 `PRIMARY KEY` 子句标识主键列，并通过 `FOREIGN KEY ... REFERENCES` 子句声明与其他逻辑表的关联关系。同义词和注释使逻辑表更易于被发现和理解。

`DIMENSIONS` 子句定义了三个维度：`customer_name` 直接映射到客户表的 `c_name` 列；`order_date` 映射到订单日期列；`order_year` 是一个计算维度，通过 `YEAR()` 函数从订单日期中提取年份。

`METRICS` 子句定义了两个指标：`customer_count` 使用 `COUNT` 聚合函数统计客户数量；`order_average_value` 使用 `AVG` 聚合函数计算平均订单价值。

#### 带过滤器和维度元数据的语义视图

以下示例在基础版本上增加了过滤器、维度唯一性标识、时间类型标识和枚举值约束，展示了语义视图的高级特性：

```sql
DROP SEMANTIC VIEW IF EXISTS tpch_rev_analysis;
CREATE SEMANTIC VIEW tpch_rev_analysis
TABLES (
    customers AS TPCH_AI.CUSTOMER
        PRIMARY KEY (c_custkey)
        COMMENT = 'Main table for customer data',
    orders AS TPCH_AI.ORDERS
        PRIMARY KEY (o_orderkey)
        FOREIGN KEY (o_custkey) REFERENCES customers
        WITH SYNONYMS ('orders_synonyms')
        COMMENT = 'All orders table for the sales domain',
    line_items AS TPCH_AI.LINEITEM
        PRIMARY KEY (l_orderkey, l_linenumber)
        FOREIGN KEY (l_orderkey) REFERENCES orders
        COMMENT = 'Line items in orders'
)
FILTERS (
    customers.is_ny AS customers.c_city = 'New York'
)
DIMENSIONS (
    customers.customer_name AS customers.c_name
        WITH SYNONYMS = ('customer name', 'dimensions_synonyms')
        is_unique = true
        COMMENT = 'Name of the customer',
    orders.order_date AS o_orderdate
        is_time = true
        enum_values = [date'2025-01-01', date'2025-06-01', date'2025-12-01']
        COMMENT = 'Date when the order was placed',
    orders.order_year AS YEAR(o_orderdate)
        COMMENT = 'Year when the order was placed'
)
METRICS (
    customers.customer_count AS COUNT(c_custkey)
        COMMENT = 'Count of number of customers',
    orders.order_average_value AS AVG(orders.o_totalprice)
        COMMENT = 'Average order value across all orders'
)
COMMENT = 'Semantic view for revenue analysis';
```

在此示例中，`FILTERS` 子句定义了一个名为 `is_ny` 的过滤器，用于筛选城市为"New York"的客户记录。该过滤器封装了一个可重用的业务筛选条件，避免在多处查询中重复编写相同的 `WHERE` 子句。

`customer_name` 维度设置了 `is_unique = true`，表示客户名称在数据集中是唯一的。`order_date` 维度设置了 `is_time = true`，表示该字段为时间属性，同时通过 `enum_values` 限定了该维度的允许取值为三个特定日期。

> **注意**：`FILTERS` 子句中定义的命名过滤器（如 `is_ny`）是面向 AI/元数据层的语义注解，不能作为 `semantic_view()` 函数的参数直接传入。若要在查询中应用过滤条件，需将对应列定义为 `DIMENSION`，再通过外层 `WHERE` 子句实现过滤。

***

## 查询语义视图

### 语法

使用 `semantic_view()` 表函数在 `SELECT` 语句中查询语义视图：

```sql
SELECT *
FROM semantic_view(
    <视图名称>,
    DIMENSIONS <维度名> [ , DIMENSIONS <维度名> ... ],
    METRICS <指标名> [ , METRICS <指标名> ... ]
);
```

在查询中，您可以使用限定名称（`<逻辑表别名>.<名称>`）或短名称（直接使用名称）来引用维度和指标。当名称在语义视图中唯一时，两种方式等效，返回相同的结果。

### 使用说明

* 查询结果会按指定的维度自动分组，并根据指标定义中的聚合函数计算指标值。语义视图引擎会根据 `TABLES` 子句中定义的外键关系自动处理所需的表连接，用户无需手动编写 JOIN 逻辑。
* 维度在结果中的排列顺序与查询中指定的顺序一致。

### 示例

#### 使用限定名称查询单维度和单指标

以下查询返回按订单日期分组的平均订单价值：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS orders.order_date,
    METRICS orders.order_average_value
);
```

输出示例：

```
2021-01-01    125.000000
```

#### 使用限定名称查询多维度

以下查询按订单日期和客户名称两个维度分组，返回平均订单价值：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS orders.order_date,
    DIMENSIONS customers.customer_name,
    METRICS orders.order_average_value
);
```

输出示例：

```
2021-01-01    Join    125.000000
```

#### 使用短名称查询

当维度和指标名称在语义视图中唯一时，可以省略逻辑表别名前缀，直接使用短名称。以下查询与上一个示例等效：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS order_date,
    DIMENSIONS customer_name,
    METRICS order_average_value
);
```

#### 使用 WHERE 子句过滤数据

将需要过滤的列定义为维度后，可通过外层 `WHERE` 子句实现数据筛选（对应 `FILTERS` 中的命名条件）：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS customers.customer_city,
    DIMENSIONS customers.customer_name,
    METRICS orders.order_average_value
) WHERE customer_city = 'New York';
```

### 传统 SQL 查询对比

为了说明语义视图如何简化查询，以下对比展示了同一分析需求分别使用传统 SQL 和语义视图的写法。

**传统 SQL 查询**：

使用传统方式，您需要手动编写 JOIN 逻辑、指定连接条件，并显式声明 GROUP BY 子句：

```sql
SELECT
    o.o_orderdate,
    c.c_name,
    AVG(o.o_totalprice) AS avg_value
FROM TPCH_SF1.ORDERS o
JOIN TPCH_SF1.CUSTOMER c ON o.o_custkey = c.c_custkey
GROUP BY o.o_orderdate, c.c_name;
```

**语义视图查询**：

使用语义视图时，您只需指定所需的维度和指标，语义视图引擎会自动根据预定义的表关系处理连接和聚合：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS order_date,
    DIMENSIONS customer_name,
    METRICS order_average_value
);
```

语义视图查询具有以下优势：

* **无需编写 JOIN 逻辑**：表连接由语义视图引擎根据外键定义自动完成。
* **使用业务术语**：如 `customer_name`、`order_average_value` 代替物理列名，提升可读性。
* **查询语法极大简化**：降低了非技术用户的使用门槛。
* **指标定义集中管理**：确保了整个组织内度量计算的一致性。

***

## 管理语义视图

### DROP SEMANTIC VIEW

删除指定的语义视图。`IF EXISTS` 子句可防止在视图不存在时报错。

**语法**：

```sql
DROP SEMANTIC VIEW IF EXISTS <视图名称>;
```

**示例**：

```sql
DROP SEMANTIC VIEW IF EXISTS tpch_rev_analysis;
```

### SHOW SEMANTIC VIEWS

列出当前架构中所有可用的语义视图。

**语法**：

```sql
SHOW SEMANTIC VIEWS;
-- 或指定架构
SHOW SEMANTIC VIEWS IN <架构名>;
```

该命令返回语义视图所在的架构名称和视图名称，方便您查看当前环境中已创建的全部语义视图。

### DESC EXTENDED

查看指定语义视图的详细定义信息，包括逻辑表结构、维度元数据、指标定义、外键关系及索引信息。

**语法**：

```sql
DESC EXTENDED <视图名称>;
```

**示例**：

```sql
DESC EXTENDED tpch_rev_analysis;
```

返回内容涵盖：逻辑表信息（物理表映射、主键和外键）、维度元数据（`isUnique`、`enumValues` 等属性）、指标定义（聚合表达式）以及索引信息（如 `BLOOM_FILTER`）。

### 相关命令速查

| 命令                             | 说明       |
| ------------------------------ | -------- |
| `CREATE SEMANTIC VIEW`         | 创建语义视图   |
| `DROP SEMANTIC VIEW IF EXISTS` | 删除语义视图   |
| `SHOW SEMANTIC VIEWS`          | 列出所有语义视图 |
| `DESC EXTENDED`                | 查看语义视图详情 |
| `semantic_view()`              | 查询语义视图   |

***

## 最佳实践

**使用 DROP IF EXISTS 确保幂等性**：在创建语义视图之前，始终先执行 `DROP SEMANTIC VIEW IF EXISTS` 语句。这确保了您的脚本在任何环境中都可以重复执行，而不会因视图已存在而失败。

```sql
DROP SEMANTIC VIEW IF EXISTS tpch_rev_analysis;
CREATE SEMANTIC VIEW tpch_rev_analysis
    ...
```

**从小规模开始，逐步扩展**：建议从一个聚焦的分析场景开始（例如 3–5 张表的收入分析），验证维度和指标的定义准确性后，再逐步扩展到更多表和更复杂的业务逻辑。

**使用有意义的业务术语命名**：为逻辑表、维度和指标选择与业务用户日常用语一致的名称。例如，使用 `customer_name` 而非 `c_name`，使用 `order_average_value` 而非 `avg_o_totalprice`。同时，善用 `WITH SYNONYMS` 和 `COMMENT` 增强语义视图的可发现性和可理解性。

**合理定义维度元数据**：正确设置 `is_unique`、`is_time` 和 `enum_values` 等属性，帮助查询引擎优化执行计划，并为下游工具和用户提供更丰富的上下文信息。

**注意逻辑表的定义顺序**：在 `TABLES` 子句中，被外键引用的逻辑表必须先于引用方定义。合理规划表的声明顺序可以避免创建时的引用错误。

***

## MCP 工具 — Semantic View 专项能力

云器 Lakehouse MCP Server 提供了一套专门面向语义视图的工具，支持通过自然语言或结构化调用完成语义视图的全生命周期管理。以下工具均通过 MCP 协议对外暴露，可集成至 AI Agent、数据助手等自动化场景。请参考[链接](LakehouseMCPServer_intro.md)。

***

### `LH-create-semantic-view` — 从 YAML 创建语义视图

从符合 Snowflake Cortex Analyst 格式的 YAML 定义创建语义视图，适合以声明式配置驱动语义视图的创建流程。

**主要参数**：

| 参数                   | 类型      | 必填 | 说明                    |
| -------------------- | ------- | -- | --------------------- |
| `semantic_view_yaml` | string  | ✅  | YAML 格式的语义视图定义        |
| `semantic_view_name` | string  | —  | 语义视图名称（可在 YAML 中声明）   |
| `schema_name`        | string  | —  | 目标 Schema 名称          |
| `if_not_exists`      | boolean | —  | 若视图已存在是否跳过（默认 `true`） |

**示例**：

```yaml
# semantic_view.yaml
name: tpch_rev_analysis
tables:
  - name: customers
    base_table:
      schema: TPCH_SF1
      table: CUSTOMER
    ...
```

```python
# MCP 调用示例（Python）
result = mcp.call("LH-create-semantic-view",
    semantic_view_yaml=open("semantic_view.yaml").read(),
    schema_name="my_schema"
)
```

***

### `LH-desc-semantic-view` — 获取语义视图 YAML 定义

以 YAML 格式返回已有语义视图的完整定义，方便版本管理、导出备份或二次编辑。

**主要参数**：

| 参数                   | 类型     | 必填 | 说明           |
| -------------------- | ------ | -- | ------------ |
| `semantic_view_name` | string | ✅  | 语义视图名称       |
| `schema_name`        | string | —  | 所在 Schema 名称 |

**示例输出（YAML 片段**）：

```yaml
name: tpch_rev_analysis
comment: Semantic view for revenue analysis
tables:
  - name: customers
    ...
dimensions:
  - name: customer_name
    expr: c_name
    is_unique: true
    ...
metrics:
  - name: customer_count
    expr: COUNT(c_custkey)
    ...
```

***

### `LH-desc-logical-table` — 查看逻辑表定义

获取语义视图中某个逻辑表的详细定义，包括其关联的物理表、维度列表及表间关系。

**主要参数**：

| 参数                   | 类型     | 必填 | 说明           |
| -------------------- | ------ | -- | ------------ |
| `semantic_view_name` | string | ✅  | 所属语义视图名称     |
| `schema_name`        | string | —  | 所在 Schema 名称 |

***

### `LH-brief-semantic-view` — 简要字段描述

以简洁格式列出语义视图中所有可用的维度和指标字段，适合快速了解视图结构，或在 Agent 规划阶段获取字段清单。

**主要参数**：

| 参数                   | 类型     | 必填 | 说明           |
| -------------------- | ------ | -- | ------------ |
| `semantic_view_name` | string | ✅  | 语义视图名称       |
| `schema_name`        | string | —  | 所在 Schema 名称 |

**示例输出**：

```
Semantic View: tpch_rev_analysis
DIMENSIONS:
  - customers.customer_name  [is_unique=true]  Name of the customer
  - customers.customer_city  City of the customer
  - orders.order_date        [is_time=true]    Date when the order was placed
  - orders.order_year        Year when the order was placed
METRICS:
  - customers.customer_count        Count of number of customers
  - orders.order_average_value      Average order value across all orders
```

***

### `LH-get_semantic_view_dims` — 获取维度列表

获取指定语义视图的所有维度定义，返回结构化的维度信息，包含维度名、物理列映射、元数据属性（`is_unique`、`is_time`、`enum_values`）及注释。

**主要参数**：

| 参数              | 类型     | 必填 | 说明                            |
| --------------- | ------ | -- | ----------------------------- |
| `semantic_view` | string | ✅  | 语义视图名称（如 `tpch_rev_analysis`） |
| `schema_name`   | string | —  | 所在 Schema 名称                  |

***

### `LH-semantic-view-dim-add` — 动态添加维度

向已存在的语义视图中追加一个或多个维度，无需重建视图，支持指定同义词、注释及元数据属性。

**主要参数**：

| 参数                   | 类型     | 必填 | 说明       |
| -------------------- | ------ | -- | -------- |
| `semantic_view_name` | string | ✅  | 目标语义视图名称 |
| `dimensions`         | array  | ✅  | 待添加的维度列表 |

`` **数组元素结构**：

| 字段               | 类型     | 必填 | 说明           |
| ---------------- | ------ | -- | ------------ |
| `logical_table`  | string | ✅  | 所属逻辑表别名      |
| `dimension_name` | string | ✅  | 维度名称         |
| `column_name`    | string | ✅  | 对应物理列名       |
| `synonyms`       | array  | ✅  | 同义词列表（可为空数组） |
| `comment`        | string | ✅  | 维度描述         |

**示例**：

```python
mcp.call("LH-semantic-view-dim-add",
    semantic_view_name="tpch_rev_analysis",
    dimensions=[{
        "logical_table": "customers",
        "dimension_name": "customer_city",
        "column_name": "c_city",
        "synonyms": ["city", "customer city"],
        "comment": "City of the customer"
    }]
)
```

***

### `LH-semantic-view-dim-del` — 动态删除维度

从已存在的语义视图中移除指定维度，无需重建视图。

**主要参数**：

| 参数                     | 类型     | 必填 | 说明       |
| ---------------------- | ------ | -- | -------- |
| `semantic_view_name`   | string | ✅  | 目标语义视图名称 |
| `dimensions_to_remove` | array  | ✅  | 待删除的维度列表 |

`` **数组元素结构**：

| 字段               | 类型     | 必填 | 说明       |
| ---------------- | ------ | -- | -------- |
| `dimension_name` | string | ✅  | 要删除的维度名称 |

**示例**：

```python
mcp.call("LH-semantic-view-dim-del",
    semantic_view_name="tpch_rev_analysis",
    dimensions_to_remove=[
        {"dimension_name": "customer_city"}
    ]
)
```

***

### `LH-query-semantic-value` — 自然语言语义查询

基于自然语言描述，从语义视图中查询数据。调用方只需指定所需的维度、指标和过滤条件，工具自动生成并执行底层 SQL，无需手写 `semantic_view()` 函数。这是 AI Agent 场景下查询语义视图的**推荐方式**。

**主要参数**：

| 参数                    | 类型     | 必填 | 说明           |
| --------------------- | ------ | -- | ------------ |
| `semantic_view_name`  | string | ✅  | 语义视图名称       |
| `selected_dimensions` | array  | ✅  | 要查询的维度列表     |
| `selected_metrics`    | array  | ✅  | 要查询的指标列表     |
| `filter_conditions`   | array  | —  | 过滤条件列表（默认为空） |

`` / `` **元素结构**：

| 字段                                 | 类型     | 说明               |
| ---------------------------------- | ------ | ---------------- |
| `logical_table`                    | string | 维度/指标所属的逻辑表名     |
| `dimensions_name` / `metrics_name` | string | 维度名或指标名（不含逻辑表前缀） |

`` **元素结构**：

| 字段           | 类型     | 说明                                                                                |
| ------------ | ------ | --------------------------------------------------------------------------------- |
| `field_name` | string | 过滤字段名（必须与 `selected_dimensions` 或 `selected_metrics` 中的名称完全一致）                    |
| `expr`       | string | 过滤表达式，遵循 SQL 语法，如 `= 'New York'`、`> 1000`、`BETWEEN '2025-01-01' AND '2025-12-31'` |

**示例**：

```python
# 查询纽约客户的平均订单价值
mcp.call("LH-query-semantic-value",
    semantic_view_name="tpch_rev_analysis",
    selected_dimensions=[
        {"logical_table": "customers", "dimensions_name": "customer_name"},
        {"logical_table": "customers", "dimensions_name": "customer_city"}
    ],
    selected_metrics=[
        {"logical_table": "orders", "metrics_name": "order_average_value"}
    ],
    filter_conditions=[
        {"field_name": "customer_city", "expr": "= 'New York'"}
    ]
)
```

**等效 SQL**：

```sql
SELECT * FROM semantic_view(
    tpch_rev_analysis,
    DIMENSIONS customers.customer_name,
    DIMENSIONS customers.customer_city,
    METRICS orders.order_average_value
) WHERE customer_city = 'New York';
```

***

### MCP 工具能力总览

| 工具名称                        | 操作类型 | 核心能力                  |
| --------------------------- | ---- | --------------------- |
| `LH-create-semantic-view`   | 创建   | 从 YAML 定义创建语义视图       |
| `LH-desc-semantic-view`     | 查看   | 获取视图完整 YAML 定义        |
| `LH-desc-logical-table`     | 查看   | 获取逻辑表结构与关系            |
| `LH-brief-semantic-view`    | 查看   | 快速浏览维度与指标字段           |
| `LH-get_semantic_view_dims` | 查看   | 获取结构化维度列表             |
| `LH-semantic-view-dim-add`  | 修改   | 动态追加维度（无需重建）          |
| `LH-semantic-view-dim-del`  | 修改   | 动态删除维度（无需重建）          |
| `LH-query-semantic-value`   | 查询   | 以结构化参数驱动语义查询，Agent 推荐 |

### 典型 Agent 工作流

```
1. LH-brief-semantic-view        → 了解视图有哪些维度和指标
2. LH-query-semantic-value       → 按需查询，传入维度/指标/过滤条件
3. LH-semantic-view-dim-add      → 若缺少所需维度，动态添加
4. LH-desc-semantic-view         → 导出 YAML 用于备份或版本比对
5. LH-create-semantic-view       → 基于 YAML 在新环境重建视图
```

^

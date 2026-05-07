# CREATE TABLE

## 功能

本语句用于创建一个新的表。在Lakehouse中，表是存储数据的基本单位。通过创建表，您可以将数据按照指定的结构进行组织和管理。

## 语法

### 基本建表语句

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name
(
    column_definition  [column_definition ,...]
    index_definition_list
)
[ PARTITIONED BY (column_name column_type | column_name | transform_function) ]
[ CLUSTERED BY (column_name,...) 
    [SORTED BY (column_name [ ASC | DESC ])] 
    [INTO num_buckets BUCKETS] 
]
[ COMMENT 'table_comment' ]
[PROPERTIES('data_lifecycle'='day_num')];


```

### column\_definition说明

#### 基本语法

```
column_name column_type 
{ NOT NULL |
  PRIMARY KEY|
  IDENTITY[(seed)]|
  GENERATED ALWAYS AS ( expr ) |
  DEFAULT default_expression |
  COMMENT column_comment |   
}
```

#### 列类型column\_type

* **column\_type**列类型，支持以下类型：

```SQL
TINYINT：1字节整数，范围 -128 到 127。
SMALLINT：2字节整数，范围 -32,768 到 32,767。
INT：4字节整数，范围 -2,147,483,648 到 2,147,483,647。
BIGINT：8字节整数，范围 -9,223,372,036,854,775,808 到 9,223,372,036,854,775,807。
FLOAT：4字节浮点数。
DOUBLE：8字节浮点数。
DECIMAL：可变长度的精确数值类型，支持指定精度和小数位数。
VARCHAR：变长字符串，最大长度限制为 65,533 字符。
CHAR：定长字符串，长度范围从 1 到 255 字符。
DATE：日期，格式为 YYYY-MM-DD。
TIMESTAMP：日期时间，时间戳表示为本地时间,格式为 YYYY-MM-DD HH:MM:SS。
TIMESTAMP_NTZ：不包含时区信息的日期和时间值，格式为 YYYY-MM-DD HH:MM:SS。
BINARY：固定长度的二进制字符串。
BOOLEAN：布尔值，真或假。
ARRAY：元素类型相同的有序集合。如：ARRAY<INT>
MAP：键值对集合，键的类型必须相同，值的类型可以相同也可以不同。如：MAP<STRING,INT>
STRUCT：字段类型不同的记录类型。如：struct<company_name:string,employee_count:int>
JSON：一种轻量级的数据交换格式。
VECTOR：数值向量类型，用于存储一系列数值。
```

* **NOT NULL**：表示该列不允许为NULL,只支持建表时指定不支持使用ALTER语法添加,需要取消NOT NULL约束时。请使用修改表类型语法：

```
ALTER TABLE table_name CHANGE COLUMN colum_name data_type
```

比如去除int类型not null约束

```
CREATE TABLE aa_not_null (id int NOT NULL)
ALTER TABLE aa_not_null CHANGE COLUMN id TYPE int;
```

#### 主键（PRIMARY KEY）

* **主键（PRIMARY KEY**） 用于确保表中每条记录的唯一性。在大数据场景下，由于数据量通常非常庞大，为了保证数据的唯一性而对所有 key 进行逐一检查是不现实且低效的，因此一般不推荐在大数据环境中使用主键约束。然而，Lakehouse 仍提供了对主键的支持，以便在特定场景下满足数据完整性的需求。在Lakehouse架构中，定义了主键的表在进行实时数据写入时，系统将自动根据主键值进行数据去重，这对于变更数据捕获（CDC）场景尤为重要。例如，您可以实时地将MySQL数据库的binlog日志同步到Lakehouse，确保数据的一致性。设置完主键需要通过[实时数据接口](java_reference/realtime-upload.md)来处理数据。在CDC实时写入过程中，系统将依据主键自动进行数据去重，以维护数据的准确性和完整性。只支持建表时指定。具体参考文档参考[主键介绍](primary-key.md)

```
CREATE    TABLE pk_table 
(id int, col string PRIMARY KEY (id));

CREATE    TABLE pk_table 
(id int PRIMARY KEY, col string);
--分桶表定义主键
CREATE    TABLE pk_table (
          id int,
          col string,
          cluster_key string,
          PRIMARY key (id)
          ) CLUSTERED BY (id, cluster_key) SORTED BY (id) INTO 16 BUCKETS;

--分区表定义主键
CREATE    TABLE pk_table (
          id int,
          col string,
          pt string,
          PRIMARY key (id, pt)
          ) PARTITIONED BY (pt);
```

#### 自增列（IDENTITY\[(seed)]）

* **IDENTITY\[(seed**)]:支持指定自增。无法保证序列中的值是连续的（无间隙），也无法保证序列值按特定顺序分配。因为表中可能会发生其他并发插入。这些限制是设计的一部分，目的是提高性能。具体使用参考[IDENTITY Column文档](IDENTITY-Column.md)

```
CREATE    TABLE identity_test (id bigint IDENTITY(1), col string);
```

#### 生成列（GENERATED ALWAYS AS）

* **GENERATED ALWAYS AS (expr**)：通过表达式`expr`自动生成列的值。表达式可以包含常量和内置标量确定性SQL函数，不支持非确定性函数如（current\_date\random\current\_timestamp\上下文函数）或运算符，不支持聚合函数、窗口函数或表函数。支持分区列使用生成列

```
CREATE TABLE t_genet (col1 TIMESTAMP,pt STRING GENERATED ALWAYS AS (date_format(col1, 'yyyy-MM-dd'))) PARTITIONED BY (pt);
```

#### 默认值（DEFAULT）

* **DEFAULT default\_expression**：为新添加的列定义一个默认值。如果在INSERT、UPDATE或MERGE操作中未指定该列的值，将自动使用此默认值。对于添加列之前已存在的数据行，该列将填充为null。支持非确定性函数如（current\_date\random\current\_timestamp\上下文函数）和常量值

```
CREATE TABLE t_default(id INT,col1 STRING DEFAULT current_timestamp());
```

### 索引定义（index\_definition\_list）

#### 基本语法

```
INDEX index_name (col_name) index_type [COMMENT 'xxxxxx'] [PROPERTIES('key'='value')]
```

**columns\_difinition**:定义表的字段信息，最后一个字段必须使用逗号隔开

**INDEX**：关键字

**index\_name**：自定义index的名称

**column\_name**：需要添加索引的字段名称

**index\_type**：索引类型，目前支持[bloomfilter](BLOOMFILTER-INDEX.md)、[inverted](inverted-index.md)、[vector](vector-index.md)

**COMMENT**：指定index的说明信息

**PROPERTIES**：指定INDEX的参数,不同的索引支持不同的参数具体参考对应索引文档

### 分区（PARTITIONED BY）

分区是一种通过在写入时将相似的行分组在一起来加快查询速度的方法。使用分区可以达到数据裁剪，优化查询。查询表时通过WHERE子句查询指定所需查询的分区，避免全表扫描，提高处理效率，降低计算资源。具体可以参考[参考分区介绍](partition_table.md)。 注意执行写入分区时单个任务目前限制2048个分区，超出此限制将会报错：`The count of dynamic partitions exceeds the maximum number 2048`。插入之前建议您先统计分区的数量如：`select count(distinct pt) from table`。如果您确实有这么多分区可以分批次导入或者您可以通过添加参数set cz.sql.table.sink.max.partition.per.thread=10000来修改此限制，lakehouse的分区总数没有限制，会在单个任务限制。如果您的数据量较小建议可以不用设置cluster key和partiiton key。建议单分区和cluster key在百MB到GB级别。例如parquet格式文件压缩后128MB

支持两种写法
第一种分区字段和类型在create table时声明，在PARTITIONED BY字据中声明字段即可

```SQL
CREATE TABLE prod.db.sample (
id bigint,
category string,
data string
)
PARTITIONED BY(category)
```

第二种分区字段和类型写在PARTITIONED BY语句中。

```SQL
CREATE TABLE prod.db.sample (
id bigint,
data string)
PARTITIONED BY(category string)
```

### 分桶表（CLUSTERED BY）

* CLUSTERED BY：指定Hash Key。Lakehouse将对指定列进行Hash运算，将数据根据Hash值分散到各个数据分桶中。为了避免数据倾斜和热点，并提高并行执行效果，建议选择取值范围大、重复键值少的列作为Hash Key。通常在进行join操作时会有明显效果。建议在数据量大的场景下使用CLUSTERED BY，一般按照一个桶的大小在128MB到1GB之间。如果没有指定分桶，默认为256个buckets。建议SORTED BY和CLUSTERED BY保持一致，以获得更好的性能。当指定SORTED BY子句后，行数据将按照指定的列进行排序。  更多信息可以参考[分桶](cluster-table.md)

```
--指定分桶并指定排序
CREATE TABLE sales_data (
    sale_id INT,
    product_id INT,
    quantity_sold INT,
    sale_date DATE
) CLUSTERED BY (product_id)
SORTED BY (sale_date DESC)
INTO 50 BUCKETS;
--指定分桶并指定桶的个数
CREATE TABLE sales_data (
    sale_id INT,
    product_id INT,
    quantity_sold INT,
    sale_date DATE
) CLUSTERED BY (product_id)
INTO 50 BUCKETS;
```

### SORTED BY

SORTED BY：指定文件内字段的排序方式。Lakehouse的SORTED BY可以单独使用，单独使用时表示在文件内排序。指定SORTED BY可以加速数据检索速度，但是写入时由于要排序，写入时可能会增加耗时

```
CREATE TABLE sales_data (
    sale_id INT,
    product_id INT,
    quantity_sold INT,
    sale_date DATE
) 
SORTED BY (sale_date DESC);
```

### PROPERTIES

* 支持设置生命周期'data\_lifecycle'='day\_num'[参考生命周期介绍](data-lifecycle.md)
* 开启[TABLE STREAM](tablestream_summary.md) ，建表时指定'change\_tracking' = 'true'并不会生效，请使用alter开启
  ALTER table test\_table set PROPERTIES ('change\_tracking' = 'true');
* 设置表的缓存策略。partiton.cache.policy.latest.count=num设置表的缓存策略。计算集群可以通过配置 `preload_table`，定时或被触发拉取 `preload_table` 中指定的表数据到计算集群本地的 SSD 硬盘上进行缓存。您还可以在表上设置缓存策略。
  例如，`partition.cache.policy.latest.count=10` 表示缓存最近的 10 个分区，当新分区添加时，旧分区的缓存将失效。也可以通过alter命令添加该参数
  例如ALTER table test\_table set PROPERTIES ('partition.cache.policy.latest.count' =10);
* 设置表的保留周期'data\_retention\_days'='num'，配置Time Travel的数据保留周期，以决定数据在时间旅行窗口中保留的时间长度。

```
--设置数据生命周期和表删除数据的保留周期
CREATE TABLE historical_prices (
    ticker_symbol STRING,
    trading_date DATE,
    closing_price DECIMAL(10, 2)
) PROPERTIES (
    'data_lifecycle' = '365',
    'data_retention_days' = '7'
);
--修改已有表的生命周期
ALTER TABLE historical_prices SET PROPERTIES(    'data_lifecycle' = '1')
```

### 使用LIKE语句建表

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name
LIKE source_table
[ COMMENT 'table_comment' ];
```

使用LIKE语句创建新表时，目标表将具有与源表相同的表结构，但不会复制数据。

### 使用AS语句建表

CREATE TABLE AS SELECT（简称CTAS）语句可用于同步或异步查询原表，并基于查询结果创建新表，然后将查询结果插入到新表中。需要注意的是，通过这种方式创建的表不会复制分区信息。

```SQL
CREATE TABLE [ IF NOT EXISTS ] table_name
[ AS select_statement ];
```

## 示例

1.创建分区表

语法一：

```SQL
CREATE TABLE table_part (id INT, name STRING)
PARTITIONED BY (age INT);
```

语法二：

```SQL
CREATE TABLE table_fpart (id INT, name STRING, dt STRING)
PARTITIONED BY (dt) COMMENT '11';
```

2.创建一个自增列作为唯一标识符的商品表

```sql
CREATE TABLE IF NOT EXISTS products (
    product_id BIGINT IDENTITY(1) COMMENT '商品ID',
    name VARCHAR(255) NOT NULL COMMENT '商品名称',
    price DECIMAL(10, 2) NOT NULL COMMENT '价格'
) COMMENT '商品列表';
```

3.创建一个带有生成列的时间戳转换表

```sql
CREATE TABLE IF NOT EXISTS timestamps (
    event_time TIMESTAMP COMMENT '事件发生时间',
    formatted_date STRING GENERATED ALWAYS AS (date_format(event_time, 'yyyy-MM-dd')) COMMENT '格式化后的日期'
) PARTITIONED BY (formatted_date);
```

4.创建一个默认值为当前时间戳的活动记录表

```sql
CREATE TABLE IF NOT EXISTS activities (
    activity_id BIGINT NOT NULL COMMENT '活动ID',
    description VARCHAR(255) COMMENT '描述',
    event_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP COMMENT '记录时间'
) COMMENT '活动记录';
```

5.创建一个带有Bloom Filter索引的搜索优化表

```sql
CREATE TABLE IF NOT EXISTS search_optimized (
    id BIGINT COMMENT 'ID',
    description VARCHAR(255) COMMENT '关键词',
    INDEX bloom_index (id) BLOOMFILTER COMMENT '布隆过滤器索引'
) COMMENT '用于快速查找的表';
```

6.创建一个带有倒排索引的文本分析表

```sql
CREATE TABLE IF NOT EXISTS text_analysis (
    doc_id BIGINT COMMENT '文档ID',
    content TEXT COMMENT '内容',
    INDEX inverted_content (content) INVERTED PROPERTIES ('analyzer' = 'chinese') COMMENT '倒排索引'
) COMMENT '用于文本分析的表';
```

7.创建一个带有分桶和排序的销售数据表

```sql
CREATE TABLE IF NOT EXISTS sales_data (
    sale_id BIGINT COMMENT '销售ID',
    product_id BIGINT COMMENT '产品ID',
    quantity_sold INT COMMENT '售出数量',
    sale_date DATE COMMENT '销售日期'
) CLUSTERED BY (product_id)
SORTED BY (sale_date DESC)
INTO 50 BUCKETS COMMENT '销售数据表';
```

8.创建一个带有生命周期管理的数据保留表

```sql
CREATE TABLE IF NOT EXISTS historical_prices (
    ticker_symbol VARCHAR(10) COMMENT '股票代码',
    trading_date DATE COMMENT '交易日期',
    closing_price DECIMAL(10, 2) COMMENT '收盘价'
) PROPERTIES (
    'data_lifecycle' = '365',
    'data_retention_days' = '1'
) COMMENT '历史股价表';
```

9.创建一个类似于现有表结构的新表

```sql
CREATE TABLE IF NOT EXISTS new_users LIKE users COMMENT '新用户表';
```

10.创建一个通过查询结果初始化的表

```sql
CREATE TABLE IF NOT EXISTS recent_sales AS
SELECT * FROM sales WHERE sale_date >= DATE_SUB(CURRENT_DATE, 3);
```

11.创建一个包含数组类型的订单详情表

```sql
CREATE TABLE IF NOT EXISTS order_details (
    order_id BIGINT COMMENT '订单ID',
    items ARRAY<STRUCT<item_id:BIGINT, quantity:INT, price:DECIMAL(10, 2)>> COMMENT '商品列表'
) COMMENT '订单详情';
```

12.创建一个带有JSON类型的客户反馈表

```sql
CREATE TABLE IF NOT EXISTS customer_feedback (
    feedback_id BIGINT COMMENT '反馈ID',
    feedback JSON COMMENT '反馈内容'
) COMMENT '客户反馈表';
```

# 使用说明

### 分区和分桶

* **分区策略的选择**：根据查询模式选择合适的分区字段。通常来说，应该选择那些能够有效缩小扫描范围的列作为分区键。比如时间戳列非常适合用作日期范围查询的分区键。

* **分桶数量的设定**：分桶数目应当根据预计的数据量及硬件资源配置来调整。一般来说，每个bucket大小应在 256MB 到 1GB 之间。过多或过少的分桶都会影响到系统的整体性能。为了获得最佳效果，建议测试不同配置下的表现，并据此做出适当调整。

* **排序字段的选择**：当使用 `SORTED BY` 子句时，选择那些频繁出现在过滤条件中的列作为排序依据。良好的排序可以帮助加速点查询和范围查询的速度，但同时也增加了写入成本。因此，在权衡利弊后作出决策非常重要。

### 索引

用户可以在建表的同时创建多个列的索引。索引也可以在建表之后再添加。如果在之后的使用过程中添加索引，如果表中已有数据，则需要重写所有数据，因此索引的创建时间取决于当前数据量。

### 表属性设置的最佳实践

* **启用数据生命周期管理**：通过设置 `data_lifecycle` 属性，可以让系统自动清理不再需要的历史数据。这对于节省存储非常有用，尤其是在处理日志或交易记录等具有明确保留期限的数据集时
* **配置变更跟踪**：如果你的应用场景涉及需要获取表的数据变化，则需要开启 `change_tracking` 。常见场景如[TABLE STRAM](tablestream_summary.md)
* **删除数据设置数据保留周期**:此参数定义了在被删除数据被保留的时间长度，对于需要进行历史数据查询的场景非常重要。例如，[table stream](tablestream_summary.md)、[restore](restore.md) 和[dynamic table](dynamic-table-introduce.md) 等功能都会依赖于这个保留周期设置。Lakehouse默认保留数据一天。根据您的业务需求，您可以通过调整 `data_retention_days` 参数来延长或缩短数据的保留周期。请注意，调整数据保留周期可能会影响存储成本。延长保留周期会增加存储需求，从而可能增加相关的费用。



# 快速分析本地的CSV 文件

### **目标**：

通过本篇文档，能够利用 Lakehouse 快速分析本地的 CSV 文件

### **分析 CSV 格式文件**：

#### **数据准备**：

本文以巴西电商公共数据集为例，在客户端的本地路径 /User/Downloads/brazil-ecommerce 有如下 csv 文件：

```
-------------/User/Downloads/brazil-ecommerce ------------------ 
olist_customers_dataset.csv.gz 
olist_geolocation_dataset.csv.gz
olist_order_items_dataset.csv.gz 
olist_order_payments_dataset.csv.gz 
olist_order_reviews_dataset.csv.gz 
olist_orders_dataset.csv.gz
olist_products_dataset.csv.gz 
olist_sellers_dataset.csv.gz 
product_category_name_translation.csv.gz
```

利用 Lakehouse JDBC 客户端 SQLLine（或 DBeaver / Datagrip 等）将数据上传至 Lakehouse User volume 空间（限制：单文件需小于5G）：

(USER VOLUME 是当前用户在当前的工作空间下，默认开通的文件存储空间，无需提前创建）

```
--在 SQLline 或者任意 Lakehouse JDBC 客户端中执行，上传单一文件：olist_customers_dataset.csv.gz

PUT '/User/Downloads/brazil-ecommerce/olist_customers_dataset.csv.gz' TO USER VOLUME SUBDIRECTORY 'bz_olist_data';
```

在客户端工具，或者 Studio SQL 任务节点中，执行如下命令展示已经上传到 USER VOLUME 中的文件：

```
show user volume directory like '%olist%';
```

#### **通过 Lakehouse SQL 快速分析数据**

如：统计每个州（state）有多少用户，并按用户数降序排序

```
SELECT count(1) as customer_number_by_state,
       customer_state,
FROM USER VOLUME (
    customer_id STRING,
    customer_unique_id STRING,
    customer_zip_code_prefix INT,
    customer_city STRING,
    customer_state STRING
 ) using csv Options
 (
     'sep' = ',',
     'compression'='gzip',  -- 目前支持 zstd/gzip/zlib 压缩格式。无压缩直接去掉此参数
     'header'='true'
 )
 FILES ('bz_olist_data/olist_customers_dataset.csv.gz')
group by customer_state
order by customer_number_by_state desc;
```

其中，Options 中的选项：

* sep：列分隔符，默认为 ” , “。最多支持长度为 1 的字符，例如：`'sep'=','`
* compression：配置文件压缩格式。支持的压缩格式有：gzip/zstd/zlib。例如：`'compression'='gzip'`
* header：是否解析表头，默认为 false。布尔类型，例如：`'header'='true'`

除此之外，还支持以下参数：

* timeZone：配置时区，没有默认值。用于指定文件中时间格式的时区。例如：`'timeZone' = 'Asia/Shanghai'`
* escape：用于转义已加引号的值中的引号，默认值为”\“，例如：`'escape'='\'`
* lineSep：行分隔符，默认值为"\n"。最多支持长度为 2 的字符，例如：`'lineSep'='$'`
* quote：设置用于转义引号值的单个字符。默认值为双引号“"“，例如：`'quote'='"'`

#### **将文件生成 lakehouse 内表**

```
CREATE TABLE OLIST_CUSTOMER_TBL
AS
SELECT * FROM USER VOLUME (
    customer_id STRING,
    customer_unique_id STRING,
    customer_zip_code_prefix INT,
    customer_city STRING,
    customer_state STRING
 ) using csv Options
 (
     'sep' = ',',
     'compression'='gzip',
     'header'='true'
 )
 FILES ('bz_olist_data/olist_customers_dataset.csv.gz');
```



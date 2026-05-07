# 数据湖常见问题 FAQ

#### **问题1**：**用 PUT 命令上传文件到 Volume 路径之后，在 SQL 处理时，查询不到文件**

**解答**：如果创建 Volume 对象时开启了文件目录表( `DIRECTORY = (enable = TRUE` ) ， 则在向该 Volume 路径中添加新文件之后，需要手动同步该变化到 Lakehouse 元数据系统，可以使用命令 `alter volume xxxx refresh; `（该命令需要执行者拥有对该 volume 对象有 alter 权限：`GRANT ALTER ON VOLUME xxxx  TO USER datalake_user;`）

^

#### **问题2**：**查询数据湖 Volume 中文件时，是否支持 CSV 文件为压缩格式**

**解答**：当前版本暂不支持 CSV 压缩格式文件，会在后续版本中支持。

^

#### **问题3：查询 CSV 文件时报错**：**CZLH-00000:CZLH-71001: CZ_SQL_TIMEZONE should exist in context**；

**解答**：需在查询中指定默认时区：在查询 volume 的 select 语句的options 中，添加 `'timeZone' = 'Asia/Shanghai' `的选项，例如：

```
select * from volume hz_csv_volume (
  order_id STRING,
  order_item_id INT,
  product_id STRING,
  seller_id STRING,
  shipping_limit_date TIMESTAMP,
  price DECIMAL(10,2),
  freight_value DECIMAL(10,2)
)using csv 
 options(
    'header'='true',
    'sep'=',',
    'timeZone' = 'Asia/Shanghai'
 ) files('brazil-ecommerce/olist_order_items_dataset.csv');
```

^

#### **问题4**：**执行远程函数（remote function）时报错**：**CZLH-42000:\[1,8] Semantic analysis exception - function not found**

**解答**：可能原因：

1. 函数是schema 级别对象，请保证执行函数时携带了正确的 schema 信息，如：函数 fc\_orc\_schema 是属于 public schema 下的对象，引用时需携带 schema 信息：`public.fc_orc_schema()`
2. 目前执行remote function时，需要在 SQL 语句前携带  `set cz.sql.remote.udf.enabled=true; `并一起执行

```
set cz.sql.remote.udf.enabled = true;
SELECT public.fc_orc_schema('orc','<url>') as schema_orc;
```

####

#### **问题5：执行远程函数时报错**：**CZLH-XX000: failed to hook preExecute: urllib3 v2.0 only supports OpenSSL 1.1.1+, currently the 'ssl' module is compiled with 'OpenSSL 1.1.0l 10 Sep 2019'.**

**解答**：python 代码中需要处理文件url 链接时，需要 urllib3 的库版本与 OpenSSL 版本不兼容，可以安装 urllib3 d的1.26.9 版本代替：`pip3 install --upgrade urllib3==1.26.9 -t .`

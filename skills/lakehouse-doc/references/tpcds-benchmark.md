# 概述

TPC-DS（Transaction Processing Performance Council - Decision Support）是一种由交易处理性能评估委员会（TPC）发布的基准测试标准，旨在评估决策支持系统（Decision Support Systems，DSS）的性能。相较于TPC-H更适合评估传统的查询和报表性能，TPC-DS包含了对数据集的分析报告、交互查询、数据挖掘等复杂应用场景，更接近真实的数据仓库业务分析场景。

本报告为您提供了云器Lakehouse与Spark SQL在TPC-DS测试集10TB规模上的测试结果，结论如下：
![](.topwrite/assets/image_1736853227228.png)

* 在TPC-DS 10TB规模数据集上的比较测试中，与Spark相比，云器Lakehouse展现出了显著的性能优势，其性能相当于Spark的9.51倍。
* 云器Lakehouse对Spark长耗时作业有明显性能提升。

# 测试环境

* **Spark测试环境**

| **配置项** | **配置信息**                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 服务器     | Hadoop集群：Master节点：1台阿里云ECS服务器（ecs.g8i.xlarge，4 vCPU 16 GiB）；Core节点：4台阿里云ECS服务器（ecs.g7.8xlarge，32 vCPU 128 GiB），每台服务器配置ESSD云盘300GiB*4 |
| 网络带宽    | 16Gbps                                                                                                            |
| 软件      | Spark 3.4.2                                                                                                       |
| 存储服务    | 阿里云OSS对象存储                                                                                                        |
| 数据格式    | Parquet（Snappy压缩）                                                                                                        |

* **云器Lakehouse测试环境**

| **配置项** | **配置信息**                             |
| ------- | ------------------------------------ |
| 计算资源    | Virtual Cluster：XLarge(128vCore等效算力) |
| 软件      | 阿里云上海Region 云器Lakehouse服务            |
| 存储服务    | 托管存储，阿里云OSS对象存储                      |

# 测试数据

| 表                       | 行数             |
| ----------------------- | -------------- |
| call\_center            | 54             |
| catalog\_page           | 40,000         |
| catalog\_returns        | 1,440,033,112  |
| catalog\_sales          | 14,399,964,710 |
| customer                | 65000000       |
| customer\_address       | 32,500,000     |
| customer\_demographics  | 1,920,800      |
| date\_dim               | 73,049         |
| household\_demographics | 7,200          |
| income\_band            | 20             |
| inventory               | 1311525000     |
| item                    | 402000         |
| promotion               | 2,000          |
| reason                  | 70             |
| ship\_mode              | 20             |
| store                   | 1,500          |
| store\_returns          | 2,880,015,149  |
| store\_sales            | 28,799,944,153 |
| time\_dim               | 86,400         |
| warehouse               | 25             |
| web\_page               | 4,002          |
| web\_returns            | 720,020,485    |
| web\_sales              | 7,199,963,324  |
| web\_site               | 78             |

* **数据表已通过ANALYZE命令收集统计信息。**

# 测试过程

在测试中，我们选择了TPC-DS基准测试中的103个复杂SQL查询，对10TB的数据集进行性能测试。测试结果包括每个查询在云器Lakehouse和Spark SQL中的执行时间，以及两者的性能对比。

## Spark SQL

在元数据服务中创建TPC-DS数据表，使用Parquet文件格式，分区设置与Lakehouse保持一致。

同时，从云器Lakehouse中导出TPC-DS 10TB测试数据，以数据文件形式保存至对象存储服务，以保证双方的测试数据一致。然后在Spark中使用INSERT INTO语句读取数据文件并写入Spark定义的数据表中。

* 运行TPC-DS 103个查询时，Spark添加了以下参数：

```SQL
--spark 生产环境大作业必调参数之一。在处理TPCDS-10T规模的数据时，若使用默认的最大并发数200，会因规模偏小而导致大量task内存占用过高，并且极易触发shuffle spill，进而使Spark运行缓慢。经测试，将该参数值调整为2000后，观察到spill大幅减少。因此，我们决定采用2000这一参数值，以优化Spark的运行性能。
set spark.sql.shuffle.partitions = 2000;spark默认值为200
```


## 云器Lakehouse

### 创建集群和表

使用云器Lakehouse XLARGE Virtual Cluster在阿里云OSS上进行测试，所有表均使用默认存储格式。

```SQL
create vcluster if not exists XLARGE_CLUSTER vcluster_size='XLARGE' vcluster_type='Analytics'  AUTO_RESUME=TRUE AUTO_SUSPEND_IN_SECOND=300 min_replicas=1 max_replicas=1;
```

### 建表语句

```SQL
drop table if exists call_center;
drop table if exists catalog_page;
drop table if exists catalog_returns;
drop table if exists catalog_sales;
drop table if exists customer;
drop table if exists customer_address;
drop table if exists customer_demographics;
drop table if exists date_dim;
drop table if exists household_demographics;
drop table if exists income_band;
drop table if exists inventory;
drop table if exists item;
drop table if exists promotion;
drop table if exists reason;
drop table if exists ship_mode;
drop table if exists store;
drop table if exists store_returns;
drop table if exists store_sales;
drop table if exists time_dim;
drop table if exists warehouse;
drop table if exists web_page;
drop table if exists web_returns;
drop table if exists web_sales;
drop table if exists web_site;
drop table if exists catalog_sales;
drop table if exists catalog_returns;

create table if not exists catalog_sales
(
      cs_sold_date_sk          int,
      cs_sold_time_sk          int,
      cs_ship_date_sk          int,
      cs_bill_customer_sk      int,
      cs_bill_cdemo_sk         int,
      cs_bill_hdemo_sk         int,
      cs_bill_addr_sk          int,
      cs_ship_customer_sk      int,
      cs_ship_cdemo_sk         int,
      cs_ship_hdemo_sk         int,
      cs_ship_addr_sk          int,
      cs_call_center_sk        int,
      cs_catalog_page_sk       int,
      cs_ship_mode_sk          int,
      cs_warehouse_sk          int,
      cs_item_sk               int,
      cs_promo_sk              int,
      cs_order_number          long,
      cs_quantity              int,
      cs_wholesale_cost        decimal(7,2),
      cs_list_price            decimal(7,2),
      cs_sales_price           decimal(7,2),
      cs_ext_discount_amt      decimal(7,2),
      cs_ext_sales_price       decimal(7,2),
      cs_ext_wholesale_cost    decimal(7,2),
      cs_ext_list_price        decimal(7,2),
      cs_ext_tax               decimal(7,2),
      cs_coupon_amt            decimal(7,2),
      cs_ext_ship_cost         decimal(7,2),
      cs_net_paid              decimal(7,2),
      cs_net_paid_inc_tax      decimal(7,2),
      cs_net_paid_inc_ship     decimal(7,2),
      cs_net_paid_inc_ship_tax decimal(7,2),
      cs_net_profit            decimal(7,2)
)  partitioned by (cs_sold_date_sk);

create table if not exists catalog_returns
(
      cr_returned_date_sk      int,
      cr_returned_time_sk      int,
      cr_item_sk               int,
      cr_refunded_customer_sk  int,
      cr_refunded_cdemo_sk     int,
      cr_refunded_hdemo_sk     int,
      cr_refunded_addr_sk      int,
      cr_returning_customer_sk int,
      cr_returning_cdemo_sk    int,
      cr_returning_hdemo_sk    int,
      cr_returning_addr_sk     int,
      cr_call_center_sk        int,
      cr_catalog_page_sk       int,
      cr_ship_mode_sk          int,
      cr_warehouse_sk          int,
      cr_reason_sk             int,
      cr_order_number          long,
      cr_return_quantity       int,
      cr_return_amount         decimal(7,2),
      cr_return_tax            decimal(7,2),
      cr_return_amt_inc_tax    decimal(7,2),
      cr_fee                   decimal(7,2),
      cr_return_ship_cost      decimal(7,2),
      cr_refunded_cash         decimal(7,2),
      cr_reversed_charge       decimal(7,2),
      cr_store_credit          decimal(7,2),
      cr_net_loss              decimal(7,2)
)  partitioned by (cr_returned_date_sk);

create table if not exists inventory
(
  inv_date_sk          int,
  inv_item_sk          int,
  inv_warehouse_sk     int,
  inv_quantity_on_hand int
)  partitioned by (inv_date_sk);

create table if not exists store_sales
(
  ss_sold_date_sk        int,
  ss_sold_time_sk        int,
  ss_item_sk             int,
  ss_customer_sk         int,
  ss_cdemo_sk            int,
  ss_hdemo_sk            int,
  ss_addr_sk             int,
  ss_store_sk            int,
  ss_promo_sk            int,
  ss_ticket_number       long,
  ss_quantity            int,
  ss_wholesale_cost      decimal(7,2),
  ss_list_price          decimal(7,2),
  ss_sales_price         decimal(7,2),
  ss_ext_discount_amt    decimal(7,2),
  ss_ext_sales_price     decimal(7,2),
  ss_ext_wholesale_cost  decimal(7,2),
  ss_ext_list_price      decimal(7,2),
  ss_ext_tax             decimal(7,2),
  ss_coupon_amt          decimal(7,2),
  ss_net_paid            decimal(7,2),
  ss_net_paid_inc_tax    decimal(7,2),
  ss_net_profit          decimal(7,2)
)  partitioned by (ss_sold_date_sk);

create table if not exists store_returns
(
  sr_returned_date_sk    int,
  sr_return_time_sk      int,
  sr_item_sk             int,
  sr_customer_sk         int,
  sr_cdemo_sk            int,
  sr_hdemo_sk            int,
  sr_addr_sk             int,
  sr_store_sk            int,
  sr_reason_sk           int,
  sr_ticket_number       long,
  sr_return_quantity     int,
  sr_return_amt          decimal(7,2),
  sr_return_tax          decimal(7,2),
  sr_return_amt_inc_tax  decimal(7,2),
  sr_fee                 decimal(7,2),
  sr_return_ship_cost    decimal(7,2),
  sr_refunded_cash       decimal(7,2),
  sr_reversed_charge     decimal(7,2),
  sr_store_credit        decimal(7,2),
  sr_net_loss            decimal(7,2)
)  partitioned by (sr_returned_date_sk);

create table if not exists web_sales
(
  ws_sold_date_sk          int,
  ws_sold_time_sk          int,
  ws_ship_date_sk          int,
  ws_item_sk               int,
  ws_bill_customer_sk      int,
  ws_bill_cdemo_sk         int,
  ws_bill_hdemo_sk         int,
  ws_bill_addr_sk          int,
  ws_ship_customer_sk      int,
  ws_ship_cdemo_sk         int,
  ws_ship_hdemo_sk         int,
  ws_ship_addr_sk          int,
  ws_web_page_sk           int,
  ws_web_site_sk           int,
  ws_ship_mode_sk          int,
  ws_warehouse_sk          int,
  ws_promo_sk              int,
  ws_order_number          long,
  ws_quantity              int,
  ws_wholesale_cost        decimal(7,2),
  ws_list_price            decimal(7,2),
  ws_sales_price           decimal(7,2),
  ws_ext_discount_amt      decimal(7,2),
  ws_ext_sales_price       decimal(7,2),
  ws_ext_wholesale_cost    decimal(7,2),
  ws_ext_list_price        decimal(7,2),
  ws_ext_tax               decimal(7,2),
  ws_coupon_amt            decimal(7,2),
  ws_ext_ship_cost         decimal(7,2),
  ws_net_paid              decimal(7,2),
  ws_net_paid_inc_tax      decimal(7,2),
  ws_net_paid_inc_ship     decimal(7,2),
  ws_net_paid_inc_ship_tax decimal(7,2),
  ws_net_profit            decimal(7,2)
) partitioned by (ws_sold_date_sk);

create table if not exists web_returns
(
  wr_returned_date_sk      int,
  wr_returned_time_sk      int,
  wr_item_sk               int,
  wr_refunded_customer_sk  int,
  wr_refunded_cdemo_sk     int,
  wr_refunded_hdemo_sk     int,
  wr_refunded_addr_sk      int,
  wr_returning_customer_sk int,
  wr_returning_cdemo_sk    int,
  wr_returning_hdemo_sk    int,
  wr_returning_addr_sk     int,
  wr_web_page_sk           int,
  wr_reason_sk             int,
  wr_order_number          long,
  wr_return_quantity       int,
  wr_return_amt            decimal(7,2),
  wr_return_tax            decimal(7,2),
  wr_return_amt_inc_tax    decimal(7,2),
  wr_fee                   decimal(7,2),
  wr_return_ship_cost      decimal(7,2),
  wr_refunded_cash         decimal(7,2),
  wr_reversed_charge       decimal(7,2),
  wr_account_credit        decimal(7,2),
  wr_net_loss              decimal(7,2)
)  partitioned by (wr_returned_date_sk);

create table if not exists call_center
(
  cc_call_center_sk        int,
  cc_call_center_id        string,
  cc_rec_start_date        date,
  cc_rec_end_date          date,
  cc_closed_date_sk        int,
  cc_open_date_sk          int,
  cc_name                  string,
  cc_class                 string,
  cc_employees             int,
  cc_sq_ft                 int,
  cc_hours                 string,
  cc_manager               string,
  cc_mkt_id                int,
  cc_mkt_class             string,
  cc_mkt_desc              string,
  cc_market_manager        string,
  cc_division              int,
  cc_division_name         string,
  cc_company               int,
  cc_company_name          string,
  cc_street_number         string,
  cc_street_name           string,
  cc_street_type           string,
  cc_suite_number          string,
  cc_city                  string,
  cc_county                string,
  cc_state                 string,
  cc_zip                   string,
  cc_country               string,
  cc_gmt_offset            decimal(5,2),
  cc_tax_percentage        decimal(5,2)
);

create table if not exists catalog_page (
  cp_catalog_page_sk       int,
  cp_catalog_page_id       string,
  cp_start_date_sk         int,
  cp_end_date_sk           int,
  cp_department            string,
  cp_catalog_number        int,
  cp_catalog_page_number   int,
  cp_description           string,
  cp_type                  string) ;

create table if not exists customer (
  c_customer_sk             int,
  c_customer_id             string,
  c_current_cdemo_sk        int,
  c_current_hdemo_sk        int,
  c_current_addr_sk         int,
  c_first_shipto_date_sk    int,
  c_first_sales_date_sk     int,
  c_salutation              string,
  c_first_name              string,
  c_last_name               string,
  c_preferred_cust_flag     string,
  c_birth_day               int,
  c_birth_month             int,
  c_birth_year              int,
  c_birth_country           string,
  c_login                   string,
  c_email_address           string,
  c_last_review_date        string) ;

create table if not exists customer_address (
  ca_address_sk             int,
  ca_address_id             string,
  ca_street_number          string,
  ca_street_name            string,
  ca_street_type            string,
  ca_suite_number           string,
  ca_city                   string,
  ca_county                 string,
  ca_state                  string,
  ca_zip                    string,
  ca_country                string,
  ca_gmt_offset             decimal(5,2),
  ca_location_type          string) ;

create table if not exists customer_demographics (
  cd_demo_sk                int,
  cd_gender                 string,
  cd_marital_status         string,
  cd_education_status       string,
  cd_purchase_estimate      int,
  cd_credit_rating          string,
  cd_dep_count              int,
  cd_dep_employed_count     int,
  cd_dep_college_count      int) ;

create table if not exists date_dim (
  d_date_sk                 int,
  d_date_id                 string,
  d_date                    date,
  d_month_seq               int,
  d_week_seq                int,
  d_quarter_seq             int,
  d_year                    int,
  d_dow                     int,
  d_moy                     int,
  d_dom                     int,
  d_qoy                     int,
  d_fy_year                 int,
  d_fy_quarter_seq          int,
  d_fy_week_seq             int,
  d_day_name                string,
  d_quarter_name            string,
  d_holiday                 string,
  d_weekend                 string,
  d_following_holiday       string,
  d_first_dom               int,
  d_last_dom                int,
  d_same_day_ly             int,
  d_same_day_lq             int,
  d_current_day             string,
  d_current_week            string,
  d_current_month           string,
  d_current_quarter         string,
  d_current_year            string) ;

create table if not exists household_demographics (
  hd_demo_sk                int,
  hd_income_band_sk         int,
  hd_buy_potential          string,
  hd_dep_count              int,
  hd_vehicle_count          int) ;

create table if not exists income_band (
  ib_income_band_sk         int,
  ib_lower_bound            int,
  ib_upper_bound            int) using parquet ;

create table if not exists item (
  i_item_sk                 int,
  i_item_id                 string,
  i_rec_start_date          date,
  i_rec_end_date            date,
  i_item_desc               string,
  i_current_price           decimal(7,2),
  i_wholesale_cost          decimal(7,2),
  i_brand_id                int,
  i_brand                   string,
  i_class_id                int,
  i_class                   string,
  i_category_id             int,
  i_category                string,
  i_manufact_id             int,
  i_manufact                string,
  i_size                    string,
  i_formulation             string,
  i_color                   string,
  i_units                   string,
  i_container               string,
  i_manager_id              int,
  i_product_name            string) ;

create table if not exists promotion (
  p_promo_sk                int,
  p_promo_id                string,
  p_start_date_sk           int,
  p_end_date_sk             int,
  p_item_sk                 int,
  p_cost                    decimal(15,2),
  p_response_target         int,
  p_promo_name              string,
  p_channel_dmail           string,
  p_channel_email           string,
  p_channel_catalog         string,
  p_channel_tv              string,
  p_channel_radio           string,
  p_channel_press           string,
  p_channel_event           string,
  p_channel_demo            string,
  p_channel_details         string,
  p_purpose                 string,
  p_discount_active         string) ;

create table if not exists reason (
  r_reason_sk               int,
  r_reason_id               string,
  r_reason_desc             string) ;

create table if not exists ship_mode (
  sm_ship_mode_sk           int,
  sm_ship_mode_id           string,
  sm_type                   string,
  sm_code                   string,
  sm_carrier                string,
  sm_contract               string) ;

create table if not exists store (
  s_store_sk                int,
  s_store_id                string,
  s_rec_start_date          date,
  s_rec_end_date            date,
  s_closed_date_sk          int,
  s_store_name              string,
  s_number_employees        int,
  s_floor_space             int,
  s_hours                   string,
  s_manager                 string,
  s_market_id               int,
  s_geography_class         string,
  s_market_desc             string,
  s_market_manager          string,
  s_division_id             int,
  s_division_name           string,
  s_company_id              int,
  s_company_name            string,
  s_street_number           string,
  s_street_name             string,
  s_street_type             string,
  s_suite_number            string,
  s_city                    string,
  s_county                  string,
  s_state                   string,
  s_zip                     string,
  s_country                 string,
  s_gmt_offset              decimal(5,2),
  s_tax_precentage          decimal(5,2)) ;

create table if not exists time_dim (
  t_time_sk                 int,
  t_time_id                 string,
  t_time                    int,
  t_hour                    int,
  t_minute                  int,
  t_second                  int,
  t_am_pm                   string,
  t_shift                   string,
  t_sub_shift               string,
  t_meal_time               string) ;

create table if not exists warehouse (
  w_warehouse_sk           int,
  w_warehouse_id           string,
  w_warehouse_name         string,
  w_warehouse_sq_ft        int,
  w_street_number          string,
  w_street_name            string,
  w_street_type            string,
  w_suite_number           string,
  w_city                   string,
  w_county                 string,
  w_state                  string,
  w_zip                    string,
  w_country                string,
  w_gmt_offset             decimal(5,2)) ;

create table if not exists web_page (
  wp_web_page_sk           int,
  wp_web_page_id           string,
  wp_rec_start_date        date,
  wp_rec_end_date          date,
  wp_creation_date_sk      int,
  wp_access_date_sk        int,
  wp_autogen_flag          string,
  wp_customer_sk           int,
  wp_url                   string,
  wp_type                  string,
  wp_char_count            int,
  wp_link_count            int,
  wp_image_count           int,
  wp_max_ad_count          int) ;

create table if not exists web_site (
  web_site_sk              int,
  web_site_id              string,
  web_rec_start_date       date,
  web_rec_end_date         date,
  web_name                 string,
  web_open_date_sk         int,
  web_close_date_sk        int,
  web_class                string,
  web_manager              string,
  web_mkt_id               int,
  web_mkt_class            string,
  web_mkt_desc             string,
  web_market_manager       string,
  web_company_id           int,
  web_company_name         string,
  web_street_number        string,
  web_street_name          string,
  web_street_type          string,
  web_suite_number         string,
  web_city                 string,
  web_county               string,
  web_state                string,
  web_zip                  string,
  web_country              string,
  web_gmt_offset           decimal(5,2),
  web_tax_percentage       decimal(5,2)) ;

analyze table call_center compute statistics for all columns;
analyze table catalog_page compute statistics for all columns;
analyze table catalog_returns compute statistics for all columns;
analyze table catalog_sales compute statistics for all columns;
analyze table customer compute statistics for all columns;
analyze table customer_address compute statistics for all columns;
analyze table customer_demographics compute statistics for all columns;
analyze table date_dim compute statistics for all columns;
analyze table household_demographics compute statistics for all columns;
analyze table income_band compute statistics for all columns;
analyze table inventory compute statistics for all columns;
analyze table item compute statistics for all columns;
analyze table promotion compute statistics for all columns;
analyze table reason compute statistics for all columns;
analyze table ship_mode compute statistics for all columns;
analyze table store compute statistics for all columns;
analyze table store_returns compute statistics for all columns;
analyze table store_sales compute statistics for all columns;
analyze table time_dim compute statistics for all columns;
analyze table warehouse compute statistics for all columns;
analyze table web_page compute statistics for all columns;
analyze table web_returns compute statistics for all columns;
analyze table web_sales compute statistics for all columns;
analyze table web_site compute statistics for all columns;
```

### 执行查询

TPC-DS 103个测试查询语句：[TPC-DS-Query-SQL](<https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/tpch/TPCDS_10TB_query.sql>)

# 测试结果

以下是云器Lakehouse和SparkSQL在103个查询上的性能测试结果，单位为秒(s)，数值越低表示性能越好。

* **所有查询均以首次执行结果为准**

| Query    | 云器Lakehouse | Spark SQL | Spark vs. Lakehouse |
| -------- | ----------- | --------- | ------------------ |
| query1   | 4.443       | 19.862    | 4.470402881        |
| query2   | 36.636      | 150.416   | 4.105688394        |
| query3   | 11.734      | 23.39     | 1.99335265         |
| query4   | 92.902      | 642.398   | 6.914791931        |
| query5   | 14.756      | 163.489   | 11.07949309        |
| query6   | 1.892       | 6.562     | 3.468287526        |
| query7   | 22.481      | 58.778    | 2.614563409        |
| query8   | 4.55        | 16.04     | 3.525274725        |
| query9   | 44.262      | 643.991   | 14.54952329        |
| query10  | 1.999       | 50.347    | 25.18609305        |
| query11  | 38.772      | 238.735   | 6.157407407        |
| query12  | 1.253       | 5.334     | 4.25698324         |
| query13  | 11.418      | 67.102    | 5.876861097        |
| query14a | 88.878      | 490.051   | 5.513749184        |
| query14b | 68.34       | 477.127   | 6.981665203        |
| query15  | 2.96        | 11.923    | 4.028040541        |
| query16  | 5.515       | 288.996   | 52.40181324        |
| query17  | 8.452       | 66.575    | 7.876833885        |
| query18  | 6.262       | 55.001    | 8.783296072        |
| query19  | 2.704       | 10.693    | 3.954511834        |
| query20  | 1.394       | 5.021     | 3.601865136        |
| query21  | 0.68        | 3.179     | 4.675              |
| query22  | 11.084      | 9.145     | 0.825063154        |
| query23a | 98.722      | 1393.112  | 14.11146452        |
| query23b | 95.845      | 1831.948  | 19.11365225        |
| query24a | 34.641      | 925.881   | 26.72789469        |
| query24b | 30.553      | 943.611   | 30.8843976         |
| query25  | 19.821      | 56.483    | 2.849654407        |
| query26  | 2.931       | 33.09     | 11.28966223        |
| query27  | 6.185       | 54.93     | 8.881164107        |
| query28  | 30.606      | 802.205   | 26.21071032        |
| query29  | 13.697      | 186.704   | 13.63101409        |
| query30  | 3.153       | 19.232    | 6.099587694        |
| query31  | 5.057       | 56.973    | 11.26616571        |
| query32  | 1.577       | 7.139     | 4.526949905        |
| query33  | 2.874       | 11.521    | 4.008698678        |
| query34  | 4.012       | 27.371    | 6.822283151        |
| query35  | 6.341       | 79.325    | 12.50985649        |
| query36  | 12.823      | 72.549    | 5.657724401        |
| query37  | 3.868       | 105.236   | 27.20682523        |
| query38  | 15.221      | 152.692   | 10.03166678        |
| query39a | 1.321       | 10.08     | 7.630582892        |
| query39b | 0.967       | 8.013     | 8.286452947        |
| query40  | 6.619       | 45.539    | 6.880042302        |
| query41  | 0.117       | 1.111     | 9.495726496        |
| query42  | 1.329       | 6.668     | 5.017306245        |
| query43  | 2.993       | 21.24     | 7.096558637        |
| query44  | 13.759      | 15.644    | 1.137001236        |
| query45  | 1.987       | 12.449    | 6.265223956        |
| query46  | 5.432       | 43.515    | 8.010861561        |
| query47  | 21.831      | 133.503   | 6.115294764        |
| query48  | 5.025       | 51.675    | 10.28358209        |
| query49  | 13.327      | 74.877    | 5.618443761        |
| query50  | 28.519      | 789.925   | 27.6982012         |
| query51  | 17.596      | 64.181    | 3.647476699        |
| query52  | 1.685       | 8.68      | 5.151335312        |
| query53  | 2.149       | 32.213    | 14.98976268        |
| query54  | 11.418      | 20.148    | 1.764582239        |
| query55  | 0.485       | 7.111     | 14.66185567        |
| query56  | 1.81        | 12.856    | 7.102762431        |
| query57  | 13.724      | 74.714    | 5.444039639        |
| query58  | 1.425       | 7.478     | 5.247719298        |
| query59  | 16.064      | 158.025   | 9.837213645        |
| query60  | 2.959       | 21.837    | 7.37985806         |
| query61  | 4.576       | 15.982    | 3.49256993         |
| query62  | 5.258       | 33.378    | 6.34804108         |
| query63  | 3.055       | 29.13     | 9.535188216        |
| query64  | 32.014      | 663.722   | 20.73224214        |
| query65  | 33.916      | 185.219   | 5.461109801        |
| query66  | 7.19        | 48.583    | 6.757023644        |
| query67  | 186.6       | 451.875   | 2.421623794        |
| query68  | 2.945       | 17.482    | 5.936162988        |
| query69  | 2.083       | 22.042    | 10.5818531         |
| query70  | 22.752      | 59.801    | 2.628384318        |
| query71  | 3.034       | 21.498    | 7.085695452        |
| query72  | 11.45       | 212.094   | 18.52349345        |
| query73  | 1.146       | 9.69      | 8.455497382        |
| query74  | 27.236      | 224.447   | 8.240820972        |
| query75  | 46.678      | 385.93    | 8.267920648        |
| query76  | 17.695      | 321.027   | 18.14224357        |
| query77  | 1.804       | 13.863    | 7.6845898          |
| query78  | 181.223     | 669.242   | 3.692919773        |
| query79  | 4.042       | 28.374    | 7.019792182        |
| query80  | 11.991      | 163.789   | 13.65932783        |
| query81  | 3.2         | 26.454    | 8.266875           |
| query82  | 4.572       | 208.444   | 45.59142607        |
| query83  | 0.795       | 6.253     | 7.865408805        |
| query84  | 4.277       | 23.8      | 5.564648118        |
| query85  | 6.826       | 46.928    | 6.874890126        |
| query86  | 7.527       | 32.703    | 4.344758868        |
| query87  | 15.751      | 159.444   | 10.12278585        |
| query88  | 52.074      | 801.005   | 15.38205246        |
| query89  | 3.389       | 34.134    | 10.07199764        |
| query90  | 4.48        | 66.709    | 14.89040179        |
| query91  | 0.527       | 6.78      | 12.86527514        |
| query92  | 1.621       | 5.989     | 3.694632943        |
| query93  | 0.03        | 0.866     | 28.86666667        |
| query94  | 10.33       | 164.88    | 15.96127783        |
| query95  | 49.464      | 381.528   | 7.713245997        |
| query96  | 11.947      | 99.414    | 8.321252197        |
| query97  | 30.497      | 178.751   | 5.861265042        |
| query98  | 2.005       | 9.795     | 4.885286783        |
| query99  | 9.352       | 62.952    | 6.731394354        |
| sum      | 1869.187    | 17779.636 | 9.511962153        |





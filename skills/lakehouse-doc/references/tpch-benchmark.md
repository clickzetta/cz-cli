# 概述

TPC-H是一个决策支持基准测试，由事务处理性能委员会（TPC）开发，包含一系列面向业务的即席查询和并发数据修改操作。本测试使用8个表，数据规模为100GB，共测试22个查询，主要性能指标为每个查询的响应时间。

本报告为您提供了云器Lakehouse与Trino在TPC-H测试集100GB规模上的测试结果，结论如下：

![](.topwrite/assets/image_1731490866092.png)

* 云器Lakehouse在所有22个查询中的总体性能表现优于Trino，Trino的总耗时是云器Lakehouse的9.84倍。
* 云器Lakehouse在所有查询中性能均优于Trino。

# 测试环境

* **Trino测试环境**

| **配置项** | **配置信息**                                                                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------- |
| 服务器     | 阿里云EMR Datalake集群服务：Master节点：1台阿里云ECS服务器（ecs.g8i.xlarge 4 vCPU 16 GiB）；Core节点：2台阿里云ECS服务器（ecs.g7.16xlarge 64 vCPU 256 GiB） |
| 网络带宽    | 32Gbps                                                                                                                     |
| 软件      | Trino(422)                                                                                                                 |
| 存储服务    | 阿里云OSS对象存储                                                                                                                 |
| 数据格式    | Parquet，LZ4压缩                                                                                                              |

* **云器Lakehouse测试环境**

| 配置项 | 配置信息                       |
| ---- | -------------------------- |
| 计算资源 | XLarge规格的计算集群（128vCPU等效算力） |
| 软件   | 阿里云上海Region-云器Lakehouse服务  |
| 存储服务 | 托管存储，阿里云OSS对象存储            |

# 测试数据

| 表名       | 行数    |
| -------- | ----- |
| customer | 1500万 |
| lineitem | 6亿    |
| nation   | 25    |
| orders   | 1.5亿  |
| part     | 2000万 |
| partsupp | 8000万 |
| region   | 5     |
| supplier | 1000万 |

数据表通过ANALYZE收集统计信息。

# 测试过程

## Trino

TPC-H数据以CSV格式文件上传至对象存储服务，使用EMR集群通过外表方式导入到Hive内表（Parquet格式，LZ4压缩）。Hive内表与云器Lakehouse表使用相同的分桶和排序设置。

所有数据表通过ANALYZE收集统计信息后，执行TPC-H的查询。

## 云器Lakehouse

### 创建集群

使用云器Lakehouse XLARGE VCluster在阿里云OSS上进行测试，所有表均使用Parquet存储格式，并设置了相同的分桶和排序规则。

```SQL
create vcluster if not exists XLARGE_CLUSTER vcluster_size='XLARGE' vcluster_type='Analytics'  AUTO_RESUME=TRUE AUTO_SUSPEND_IN_SECOND=300 min_replicas=1 max_replicas=1;
```

### 建表语句

```SQL
CREATE TABLE demo_examples.tpch_100g_cluster.customer(
  `c_custkey` int not null,
  `c_name` varchar(25) not null,
  `c_address` varchar(40) not null,
  `c_nationkey` int not null,
  `c_phone` varchar(15) not null,
  `c_acctbal` decimal(15,2) not null,
  `c_mktsegment` varchar(10) not null,
  `c_comment` varchar(117) not null)
HASH CLUSTERED BY(`c_custkey`)
SORTED BY(`c_custkey` ASC)
INTO 128 BUCKETS;

CREATE TABLE demo_examples.tpch_100g_cluster.lineitem(
  `l_orderkey` int not null,
  `l_partkey` int not null,
  `l_suppkey` int not null,
  `l_linenumber` int not null,
  `l_quantity` decimal(15,2) not null,
  `l_extendedprice` decimal(15,2) not null,
  `l_discount` decimal(15,2) not null,
  `l_tax` decimal(15,2) not null,
  `l_returnflag` char(1) not null,
  `l_linestatus` char(1) not null,
  `l_shipdate` date not null,
  `l_commitdate` date not null,
  `l_receiptdate` date not null,
  `l_shipinstruct` char(25) not null,
  `l_shipmode` char(10) not null,
  `l_comment` varchar(44) not null)
HASH CLUSTERED BY(`l_orderkey`)
SORTED BY(`l_shipdate` ASC,`l_orderkey` ASC)
INTO 128 BUCKETS;

CREATE TABLE demo_examples.tpch_100g_cluster.nation(
  `n_nationkey` int not null,
  `n_name` char(25) not null,
  `n_regionkey` int not null,
  `n_comment` varchar(152));

CREATE TABLE demo_examples.tpch_100g_cluster.orders(
  `o_orderkey` int not null,
  `o_custkey` int not null,
  `o_orderstatus` char(1) not null,
  `o_totalprice` decimal(15,2) not null,
  `o_orderdate` date not null,
  `o_orderpriority` char(15) not null,
  `o_clerk` char(15) not null,
  `o_shippriority` int not null,
  `o_comment` varchar(79) not null)
HASH CLUSTERED BY(`o_orderkey`)
SORTED BY(`o_orderdate` ASC,`o_orderkey` ASC)
INTO 128 BUCKETS;

CREATE TABLE demo_examples.tpch_100g_cluster.part(
  `p_partkey` int not null,
  `p_name` varchar(55) not null,
  `p_mfgr` char(25) not null,
  `p_brand` char(10) not null,
  `p_type` varchar(25) not null,
  `p_size` int not null,
  `p_container` char(10) not null,
  `p_retailprice` decimal(15,2) not null,
  `p_comment` varchar(23) not null)
HASH CLUSTERED BY(`p_partkey`)
SORTED BY(`p_partkey` ASC)
INTO 128 BUCKETS;

CREATE TABLE demo_examples.tpch_100g_cluster.partsupp(
  `ps_partkey` int not null,
  `ps_suppkey` int not null,
  `ps_availqty` int not null,
  `ps_supplycost` decimal(15,2) not null,
  `ps_comment` varchar(199) not null)
HASH CLUSTERED BY(`ps_partkey`)
SORTED BY(`ps_partkey` ASC)
INTO 128 BUCKETS;

CREATE TABLE demo_examples.tpch_100g_cluster.region(
  `r_regionkey` int not null,
  `r_name` char(25) not null,
  `r_comment` varchar(152));

CREATE TABLE demo_examples.tpch_100g_cluster.supplier(
  `s_suppkey` int not null,
  `s_name` char(25) not null,
  `s_address` varchar(40) not null,
  `s_nationkey` int not null,
  `s_phone` char(15) not null,
  `s_acctbal` decimal(15,2) not null,
  `s_comment` varchar(101) not null)
HASH CLUSTERED BY(`s_suppkey`)
SORTED BY(`s_suppkey` ASC)
INTO 128 BUCKETS;
```

### 执行查询

```SQL
--关闭result cache
set cz.sql.enable.shortcut.result.cache=false;
-- Q1
select /*Q1*/
    l_returnflag,
    l_linestatus,
    sum(l_quantity) as sum_qty,
    sum(l_extendedprice) as sum_base_price,
    sum(l_extendedprice * (1 - l_discount)) as sum_disc_price,
    sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge,
    avg(l_quantity) as avg_qty,
    avg(l_extendedprice) as avg_price,
    avg(l_discount) as avg_disc,
    count(*) as count_order
from
    clickzetta_sample_data.tpch_100g.lineitem
where
    l_shipdate <= date '1998-12-01' - interval '85' day
group by
    l_returnflag,
    l_linestatus
order by
    l_returnflag,
    l_linestatus;

-- Q2
select /*Q2*/
s_acctbal, -- 帐户余额
s_name, -- 名字
n_name, -- 国家
p_partkey, -- 零件的号码
p_mfgr, -- 生产者
s_address, -- 供应者的地址
s_phone, -- 电话号码
s_comment -- 备注信息
from
clickzetta_sample_data.tpch_100g.part,
clickzetta_sample_data.tpch_100g.supplier,
clickzetta_sample_data.tpch_100g.partsupp,
clickzetta_sample_data.tpch_100g.nation,
clickzetta_sample_data.tpch_100g.region
where
p_partkey = ps_partkey
and s_suppkey = ps_suppkey
and p_size = 15 -- 指定大小，在区间[1, 50]内随机选择
and p_type like '%BRASS' -- 指定类型，在TPC-H标准指定的范围内随机选择
and s_nationkey = n_nationkey
and n_regionkey = r_regionkey
and r_name = 'EUROPE' -- 指定地区，在TPC-H标准指定的范围内随机选择
and ps_supplycost = (
select
min(ps_supplycost) --聚集函数
from   -- 与父查询的表有重叠
clickzetta_sample_data.tpch_100g.partsupp,
clickzetta_sample_data.tpch_100g.supplier,
clickzetta_sample_data.tpch_100g.nation,
clickzetta_sample_data.tpch_100g.region
where
p_partkey = ps_partkey
and s_suppkey = ps_suppkey
and s_nationkey = n_nationkey
and n_regionkey = r_regionkey
and r_name = 'EUROPE'
)
order by
s_acctbal desc,
n_name,
s_name,
p_partkey
limit 100;

-- Q3
select /*Q3*/
    l_orderkey,
    sum(l_extendedprice * (1 - l_discount)) as revenue, -- 潜在的收入，聚集操作
    o_orderdate,
    o_shippriority
from
    clickzetta_sample_data.tpch_100g.customer,
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.lineitem
where
    c_mktsegment = 'BUILDING' -- 在TPC-H标准指定的范围内随机选择
    and c_custkey = o_custkey
    and l_orderkey = o_orderkey
    and o_orderdate < '1995-03-15' -- 指定日期段，在在[1995-03-01, 1995-03-31]中随机选择
    and l_shipdate > '1995-03-15'  -- 指定日期段，在在[1995-03-01, 1995-03-31]中随机选择
group by
    l_orderkey, -- 订单标识
    o_orderdate,  -- 订单日期
    o_shippriority -- 运输优先级
order by
    revenue desc, -- 降序排序，把潜在最大收入列在前面
    o_orderdate
limit 10;

-- Q4
select /*Q4*/
    o_orderpriority,
    count(*) as order_count
from
    clickzetta_sample_data.tpch_100g.orders
where
    o_orderdate >= date '1993-10-01'
    and o_orderdate < date '1993-10-01' + interval '3' month
    and exists (
        select
            *
        from
            clickzetta_sample_data.tpch_100g.lineitem
        where
            l_orderkey = o_orderkey
            and l_commitdate < l_receiptdate
    )
group by
    o_orderpriority
order by
    o_orderpriority;

-- Q5
select /*Q5*/
    n_name,
    sum(l_extendedprice * (1 - l_discount)) as revenue
from
    clickzetta_sample_data.tpch_100g.customer,
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.lineitem,
    clickzetta_sample_data.tpch_100g.supplier,
    clickzetta_sample_data.tpch_100g.nation,
    clickzetta_sample_data.tpch_100g.region
where
    c_custkey = o_custkey
    and l_orderkey = o_orderkey
    and l_suppkey = s_suppkey
    and c_nationkey = s_nationkey
    and s_nationkey = n_nationkey
    and n_regionkey = r_regionkey
    and r_name = 'ASIA' -- 指定地区，在TPC-H标准指定的范围内随机选择
    and o_orderdate >= '1994-01-01' -- DATE是从1993年到1997年中随机选择的一年的1月1日
    and o_orderdate < date '1996-01-01' + interval '1' year
group by
    n_name -- 按名字分组
order by
    revenue desc; -- 按收入降序排序，注意分组和排序子句不同

-- Q6
select /*Q6*/
    sum(l_extendedprice * l_discount) as revenue -- 潜在的收入增加量
from
    clickzetta_sample_data.tpch_100g.lineitem
where
    l_shipdate >= '1994-01-01' -- DATE是从[1993, 1997]中随机选择的一年的1月1日
    and l_shipdate < date '1996-01-01' + interval '1' year -- 一年内
    and l_discount between 0.06 - 0.01 and 0.06 + 0.01
    and l_quantity < 24; -- QUANTITY在区间[24, 25]中随机选择

-- Q7
select/*Q7*/
    supp_nation, -- 供货商国家
    cust_nation, -- 顾客国家
    l_year,
    sum(volume) as revenue -- 年度、年度的货运收入
from
    (
        select
            n1.n_name as supp_nation,
            n2.n_name as cust_nation,
            extract(year from l_shipdate) as l_year,
            l_extendedprice * (1 - l_discount) as volume
        from
            clickzetta_sample_data.tpch_100g.supplier,
            clickzetta_sample_data.tpch_100g.lineitem,
            clickzetta_sample_data.tpch_100g.orders,
            clickzetta_sample_data.tpch_100g.customer,
            clickzetta_sample_data.tpch_100g.nation n1,
            clickzetta_sample_data.tpch_100g.nation n2
        where
            s_suppkey = l_suppkey
            and o_orderkey = l_orderkey
            and c_custkey = o_custkey
            and s_nationkey = n1.n_nationkey
            and c_nationkey = n2.n_nationkey
            and ( -- NATION2和NATION1的值不同，表示查询的是跨国的货运情况
                (n1.n_name = 'FRANCE' and n2.n_name = 'GERMANY')
                or (n1.n_name = 'GERMANY' and n2.n_name = 'FRANCE')
            )
            and l_shipdate between '1995-01-01' and '1996-12-31'
    ) as shipping
group by
    supp_nation,
    cust_nation,
    l_year
order by
    supp_nation,
    cust_nation,
    l_year;

-- Q8
select /*Q8*/
    o_year, -- 年份
    sum(case
        when nation = 'BRAZIL' then volume -- 指定国家，在TPC-H标准指定的范围内随机选择
        else 0
    end) / sum(volume) as mkt_share -- 市场份额：特定种类的产品收入的百分比；聚集操作
from
    (
        select
            extract(year from o_orderdate) as o_year, -- 分解出年份
            l_extendedprice * (1 - l_discount) as volume, -- 特定种类的产品收入
            n2.n_name as nation
        from
            clickzetta_sample_data.tpch_100g.part,
            clickzetta_sample_data.tpch_100g.supplier,
            clickzetta_sample_data.tpch_100g.lineitem,
            clickzetta_sample_data.tpch_100g.orders,
            clickzetta_sample_data.tpch_100g.customer,
            clickzetta_sample_data.tpch_100g.nation n1,
            clickzetta_sample_data.tpch_100g.nation n2,
            clickzetta_sample_data.tpch_100g.region
        where
            p_partkey = l_partkey
            and s_suppkey = l_suppkey
            and l_orderkey = o_orderkey
            and o_custkey = c_custkey
            and c_nationkey = n1.n_nationkey
            and n1.n_regionkey = r_regionkey
            and r_name = 'AMERICA' -- 指定地区，在TPC-H标准指定的范围内随机选择
            and s_nationkey = n2.n_nationkey
            and o_orderdate between '1995-01-01' and '1996-12-31' -- 只查95、96年的情况
            and p_type = 'ECONOMY ANODIZED STEEL' -- 指定零件类型，在TPC-H标准指定的范围内随机选择
    ) as all_nations
group by
    o_year -- 按年分组
order by
    o_year; -- 按年排序

-- Q9
select /*Q9*/
    nation,
    o_year,
    sum(amount) as sum_profit --每个国家每一年所有被定购的零件在一年中的总利润
from
    (
        select
            n_name as nation, -- 国家
            extract(year from o_orderdate) as o_year, -- 取出年份
            l_extendedprice * (1 - l_discount) - ps_supplycost * l_quantity as amount --利润
        from
            clickzetta_sample_data.tpch_100g.part,
            clickzetta_sample_data.tpch_100g.supplier,
            clickzetta_sample_data.tpch_100g.lineitem,
            clickzetta_sample_data.tpch_100g.partsupp,
            clickzetta_sample_data.tpch_100g.orders,
            clickzetta_sample_data.tpch_100g.nation
        where
            s_suppkey = l_suppkey
            and ps_suppkey = l_suppkey
            and ps_partkey = l_partkey
            and p_partkey = l_partkey
            and o_orderkey = l_orderkey
            and s_nationkey = n_nationkey
            and p_name like '%green%' -- LIKE操作，查询优化器可能进行优化
    ) as profit
group by
    nation, -- 国家
    o_year  -- 年份
order by
    nation, 
    o_year desc;

-- Q10
select /*Q10*/
    c_custkey,
    c_name,
    sum(l_extendedprice * (1 - l_discount)) as revenue,
    c_acctbal,
    n_name,
    c_address,
    c_phone,
    c_comment
from
    clickzetta_sample_data.tpch_100g.customer,
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.lineitem,
    clickzetta_sample_data.tpch_100g.nation
where
    c_custkey = o_custkey
    and l_orderkey = o_orderkey
    and o_orderdate >= date '1993-04-01'
    and o_orderdate < date '1993-04-01' + interval '3' month
    and l_returnflag = 'R'
    and c_nationkey = n_nationkey
group by
    c_custkey,
    c_name,
    c_acctbal,
    c_phone,
    n_name,
    c_address,
    c_comment
order by
    revenue desc
limit 20;

-- Q11
select /*Q11*/
    ps_partkey,
    sum(ps_supplycost * ps_availqty) as value
from
    clickzetta_sample_data.tpch_100g.partsupp,
    clickzetta_sample_data.tpch_100g.supplier,
    clickzetta_sample_data.tpch_100g.nation
where
    ps_suppkey = s_suppkey
    and s_nationkey = n_nationkey
    and n_name = 'CANADA'
group by
    ps_partkey having
        sum(ps_supplycost * ps_availqty) > (
            select
                sum(ps_supplycost * ps_availqty) * 0.000001000000
            from
                clickzetta_sample_data.tpch_100g.partsupp,
                clickzetta_sample_data.tpch_100g.supplier,
                clickzetta_sample_data.tpch_100g.nation
            where
                ps_suppkey = s_suppkey
                and s_nationkey = n_nationkey
                and n_name = 'CANADA'
        )
order by
    value desc;

-- Q12
select/*Q12*/
    l_shipmode,
    sum(case
        when o_orderpriority = '1-URGENT'
            or o_orderpriority = '2-HIGH'
            then 1
        else 0
    end) as high_line_count,
    sum(case
        when o_orderpriority <> '1-URGENT'
            and o_orderpriority <> '2-HIGH'
            then 1
        else 0
    end) as low_line_count
from
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.lineitem
where
    o_orderkey = l_orderkey
    and l_shipmode in ('RAIL', 'SHIP')
    and l_commitdate < l_receiptdate
    and l_shipdate < l_commitdate
    and l_receiptdate >= date '1994-01-01'
    and l_receiptdate < date '1994-01-01' + interval '1' year
group by
    l_shipmode
order by
    l_shipmode;

-- Q13
select/*Q13*/
    c_count,
    count(*) as custdist
from
    (
        select
            c_custkey,
            count(o_orderkey) as c_count
        from  -- 子查询中包括左外连接操作
            clickzetta_sample_data.tpch_100g.customer left outer join clickzetta_sample_data.tpch_100g.orders on
                c_custkey = o_custkey
                and o_comment not like '%special%requests%'
                -- WORD1 为以下四个可能值中任意一个：special、pending、unusual、express
                -- WORD2 为以下四个可能值中任意一个：packages、requests、accounts、deposits
        group by
            c_custkey
    ) c_orders
group by
    c_count
order by
    custdist desc,
    c_count desc;

-- Q14
select/*14*/
    100.00 * sum(case
        when p_type like 'PROMO%'  -- 促销零件
            then l_extendedprice * (1 - l_discount)  -- 某一特定时间的收入
        else 0
    end) / sum(l_extendedprice * (1 - l_discount)) as promo_revenue
from
    clickzetta_sample_data.tpch_100g.lineitem,
    clickzetta_sample_data.tpch_100g.part
where
    l_partkey = p_partkey
    and l_shipdate >= date '1994-04-01' -- DATE是从1993年到1997年中任一年的任一月的一号
    and l_shipdate < date '1994-04-01' + interval '1' month;    

-- Q15
select/*Q15*/
    s_suppkey,
    s_name,
    s_address,
    s_phone,
    total_revenue
from
    clickzetta_sample_data.tpch_100g.supplier,
    (
        select
            l_suppkey supplier_no,
            sum(l_extendedprice * (1 - l_discount)) total_revenue
        from
            clickzetta_sample_data.tpch_100g.lineitem
        where
                l_shipdate >= date '1994-05-01'
          and l_shipdate < date '1994-05-01' + interval '3' month
        group by
            l_suppkey
    ) as revenue0
where
    s_suppkey = supplier_no
    and total_revenue = (
        select
            max(total_revenue)
        from 
            (
        select
            l_suppkey supplier_no,
            sum(l_extendedprice * (1 - l_discount)) total_revenue
        from
            clickzetta_sample_data.tpch_100g.lineitem
        where
                l_shipdate >= date '1994-05-01'
          and l_shipdate < date '1994-05-01' + interval '3' month
        group by
            l_suppkey
        ) as revenue0
    )
order by
    s_suppkey;

-- Q16
select/*Q16*/
    p_brand,
    p_type,
    p_size,
    count(distinct ps_suppkey) as supplier_cnt -- 聚集、去重操作
from
    clickzetta_sample_data.tpch_100g.partsupp,
    clickzetta_sample_data.tpch_100g.part
where
    p_partkey = ps_partkey
    and p_brand <> 'Brand#45' --BRAND＝Brand  --MN ，M和N是两个字母，代表两个数值，相互独立，取值在1到5之间
    and p_type not like 'MEDIUM POLISHED%' -- 消费者不感兴趣的类型和尺寸
    and p_size in (49, 14, 23, 45, 19, 3, 36, 9) -- TYPEX是在1到50之间任意选择的一组八个不同的值
    and ps_suppkey not in ( -- NOT IN子查询，消费者排除某些供货商
        select
            s_suppkey
        from
            clickzetta_sample_data.tpch_100g.supplier
        where
            s_comment like '%Customer%Complaints%'
    )
group by
    p_brand,
    p_type,
    p_size
order by  -- 按数量降序排列，按品牌、种类、尺寸升序排列
    supplier_cnt desc,  
    p_brand,
    p_type,
    p_size;

-- Q17
select /*Q17*/
    sum(l_extendedprice) / 7.0 as avg_yearly
from
    clickzetta_sample_data.tpch_100g.lineitem,
    clickzetta_sample_data.tpch_100g.part
where
    p_partkey = l_partkey
    and p_brand = 'Brand#23'
    and p_container = 'WRAP BAG'
    and l_quantity < (
        select
            0.2 * avg(l_quantity)
        from
            clickzetta_sample_data.tpch_100g.lineitem
        where
            l_partkey = p_partkey
    );

-- Q18
select /*Q18*/
    c_name,
    c_custkey,
    o_orderkey,
    o_orderdate,
    o_totalprice,
    sum(l_quantity) --订货总数
from
    clickzetta_sample_data.tpch_100g.customer,
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.lineitem
where
    o_orderkey in (
        select
            l_orderkey
        from
            clickzetta_sample_data.tpch_100g.lineitem
        group by
            l_orderkey having
                sum(l_quantity) > 300 -- QUANTITY是位于312到315之间的任意值
    )
    and c_custkey = o_custkey
    and o_orderkey = l_orderkey
group by
    c_name,
    c_custkey,
    o_orderkey,
    o_orderdate,
    o_totalprice
order by
    o_totalprice desc,
    o_orderdate
limit 100;

-- Q19
select/*Q19*/
    sum(l_extendedprice* (1 - l_discount)) as revenue
from
    clickzetta_sample_data.tpch_100g.lineitem,
    clickzetta_sample_data.tpch_100g.part
where
    (
        p_partkey = l_partkey
        and p_brand = 'Brand#12' 
        and p_container in ('SM CASE', 'SM BOX', 'SM PACK', 'SM PKG') 
        and l_quantity >= 1 and l_quantity <= 1 + 10 
        and p_size between 1 and 5 
        and l_shipmode in ('AIR', 'AIR REG') 
        and l_shipinstruct = 'DELIVER IN PERSON'
    )
    or
    (
        p_partkey = l_partkey
        and p_brand = 'Brand#23'
        and p_container in ('MED BAG', 'MED BOX', 'MED PKG', 'MED PACK')
        and l_quantity >= 10 and l_quantity <= 10 + 10 
        and p_size between 1 and 10
        and l_shipmode in ('AIR', 'AIR REG')
        and l_shipinstruct = 'DELIVER IN PERSON'
    )
    or
    (
        p_partkey = l_partkey
        and p_brand = 'Brand#34'
        and p_container in ('LG CASE', 'LG BOX', 'LG PACK', 'LG PKG')
        and l_quantity >= 20 and l_quantity <= 20 + 10 
        and p_size between 1 and 15
        and l_shipmode in ('AIR', 'AIR REG')
        and l_shipinstruct = 'DELIVER IN PERSON'
    );

-- Q20
select/*Q20*/
    s_name,
    s_address
from
    clickzetta_sample_data.tpch_100g.supplier,
    clickzetta_sample_data.tpch_100g.nation
where
    s_suppkey in (
        select
            ps_suppkey
        from
            clickzetta_sample_data.tpch_100g.partsupp
        where
            ps_partkey in (
                select
                    p_partkey
                from
                    clickzetta_sample_data.tpch_100g.part
                where
                    p_name like 'antique%'
            )
            and ps_availqty > (
                select
                    0.5 * sum(l_quantity)
                from
                    clickzetta_sample_data.tpch_100g.lineitem
                where
                    l_partkey = ps_partkey
                    and l_suppkey = ps_suppkey
                    and l_shipdate >= date '1993-01-01'
                    and l_shipdate < date '1993-01-01' + interval '1' year
            )
    )
    and s_nationkey = n_nationkey
    and n_name = 'IRAQ'
order by
    s_name;

-- Q21
select /*Q21*/
    s_name,
    count(*) as numwait
from
    clickzetta_sample_data.tpch_100g.supplier,
    clickzetta_sample_data.tpch_100g.lineitem l1,
    clickzetta_sample_data.tpch_100g.orders,
    clickzetta_sample_data.tpch_100g.nation
where
    s_suppkey = l1.l_suppkey
    and o_orderkey = l1.l_orderkey
    and o_orderstatus = 'F'
    and l1.l_receiptdate > l1.l_commitdate
    and exists ( -- EXISTS子查询
        select
            *
        from
            clickzetta_sample_data.tpch_100g.lineitem l2
        where
            l2.l_orderkey = l1.l_orderkey
            and l2.l_suppkey <> l1.l_suppkey
    )
    and not exists (-- NOT EXISTS子查询
        select
            *
        from
           clickzetta_sample_data.tpch_100g.lineitem l3
        where
            l3.l_orderkey = l1.l_orderkey
            and l3.l_suppkey <> l1.l_suppkey
            and l3.l_receiptdate > l3.l_commitdate
    )
    and s_nationkey = n_nationkey
    and n_name = 'SAUDI ARABIA' -- TPC-H标准定义的任意值
group by
    s_name
order by
    numwait desc,
    s_name
limit 100;

-- Q22
select/*Q22*/
    cntrycode,
    count(*) as numcust,
    sum(c_acctbal) as totacctbal
from
    ( -- 第一层子查询
        select
            substring(c_phone from 1 for 2) as cntrycode,
            c_acctbal
        from
            clickzetta_sample_data.tpch_100g.customer
        where
            substring(c_phone from 1 for 2) in
                ('13', '31', '23', '29', '30', '18', '17') -- I1…I7是在TPC-H中定义国家代码的可能值中不重复的任意值
            and c_acctbal > ( -- 第二层聚集子查询
                select
                    avg(c_acctbal)
                from
                    clickzetta_sample_data.tpch_100g.customer
                where
                    c_acctbal > 0.00
                    and substring(c_phone from 1 for 2) in
                        ('13', '31', '23', '29', '30', '18', '17')
            )
            and not exists ( -- 第二层NOT EXISTS子查询
                select
                    *
                from
                    clickzetta_sample_data.tpch_100g.orders
                where
                    o_custkey = c_custkey
            )
    ) as custsale
group by
    cntrycode
order by
    cntrycode;
```

# 测试结果

以下是云器Lakehouse和Trino在22个查询上的性能测试结果，单位为毫秒（ms），数值越低表示性能越好。
- 所有查询预热一次后，执行三次取平均值作为结果。

| 查询 | 云器Lakehouse | Trino | Trino vs 云器Lakehouse |
| --- | ----------- | ----- | -------------------- |
| Q1  | 658         | 3240  | 4.92                 |
| Q2  | 180         | 740   | 4.11                 |
| Q3  | 300         | 1840  | 6.13                 |
| Q4  | 177         | 2970  | 16.78                |
| Q5  | 844         | 1670  | 1.98                 |
| Q6  | 89          | 2550  | 28.65                |
| Q7  | 251         | 1190  | 4.74                 |
| Q8  | 441         | 2400  | 5.44                 |
| Q9  | 794         | 12830 | 16.16                |
| Q10 | 308         | 2520  | 8.18                 |
| Q11 | 151         | 300   | 1.99                 |
| Q12 | 122         | 1060  | 8.69                 |
| Q13 | 532         | 4570  | 8.59                 |
| Q14 | 87          | 2480  | 28.51                |
| Q15 | 155         | 4140  | 26.71                |
| Q16 | 177         | 1670  | 9.44                 |
| Q17 | 257         | 8520  | 33.15                |
| Q18 | 726         | 9280  | 12.78                |
| Q19 | 261         | 910   | 3.49                 |
| Q20 | 197         | 2710  | 13.76                |
| Q21 | 462         | 3650  | 7.90                 |
| Q22 | 233         | 1620  | 6.95                 |
| 总计  | 7402        | 72860 | 9.84                 |



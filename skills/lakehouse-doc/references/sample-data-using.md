# 使用样例数据快速开始查询分析

## 教程概述

通过本教程，您将了解如何利用 Lakehouse 平台内置的样例数据集，无需提前准备数据即可快速使用 SQL 进行查询分析，以评估其功能及性能。

样例数据集由云器平台通过名称为CLICKZETTA\_SAMPLE\_DATA的数据集以共享方式开放给所有账户查询。本教程将以其中的 TPC-H 100GB 数据集为例，介绍如何在 Lakehouse 中快速完成 TPC-H 测试集的查询测试，评估处理性能。

本教程将按以下步骤进行：

* 环境准备：通过样例数据集检查原始数据，创建测试使用的计算集群
* 发起查询：使用 Studio Web 环境创建 SQL 查询，完成 22 个 TPC-H SQL 查询
* 变更集群大小：调整集群大小，扩大至之前集群大小的 4 倍
* 发起查询：使用调整大小后的集群再次完成 22 个 TPC-H SQL 查询
* 观察不同集群规格下，查询时延的变化

## Step01. 准备工作

首先，登录 Lakehouse Web 控制台并进入指定的工作空间后，可访问“数据”模块，检查数据管理下的数据对象列表中“clickzetta_sample_data.tpch_100gb”下的相关表是否存在。
![](.topwrite/assets/image_1716285499384.png)

其次，我们将为本次测试临时创建一个独立的计算集群用于查询分析。您可以通过访问 Lakehouse Web 控制台的“计算 → 集群”菜单，通过页面向导新建集群。
![](.topwrite/assets/tpch_100g_vc.png)

同时，您也可以通过 SQL 命令来创建集群。使用 SQL 命令操作时，您可以在不离开 SQL 开发上下文的情况下，在 Ad-hoc 或 ETL 开发过程中通过 SQL 命令控制集群的创建、扩/缩容、暂停/恢复、销毁等操作，这通常可以提高计算资源的操作效率。

本教程中，通过在“开发”模块新建 SQL 脚本任务并执行以下脚本，即可快速创建集群。
![](.topwrite/assets/image_1716953675576.png)

```sql
-- 创建分析型虚拟计算资源
create vcluster if not exists TPCH_100GB vcluster_size='Medium' vcluster_type='Analytics'  AUTO_RESUME=TRUE AUTO_SUSPEND_IN_SECOND=300 min_replicas=1 max_replicas=1 comment 'TPCH 100GB TEST';
```

> 注：计算集群的 vcluster_size 参数同时支持以 T-shirt size（XSMALL、SMALL、LARGE 等）和以数字（1, 2, 4, 16 等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

^

## Step02. 对样例数据进行TPC-H的查询

在“开发”模块新建 SQL 脚本任务，录入 TPC-H 的 22 个查询语句，在“集群”下拉列表中选择刚才创建的测试集群，然后选中任务中的全部脚本并点击“运行”按钮进行串行查询。
![](.topwrite/assets/image_1716953736183.png)

查询脚本为：

```sql
-- 执行使用TPCH_100GB计算资源运行作业
use vcluster TPCH_100GB;

-- 设置查询的标签
set query_tag='tpch100g_benchmark';

-- Q1
select
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
select
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
select
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
select
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
select
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
select
    sum(l_extendedprice * l_discount) as revenue -- 潜在的收入增加量
from
    clickzetta_sample_data.tpch_100g.lineitem
where
    l_shipdate >= '1994-01-01' -- DATE是从[1993, 1997]中随机选择的一年的1月1日
    and l_shipdate < date '1996-01-01' + interval '1' year -- 一年内
    and l_discount between 0.06 - 0.01 and 0.06 + 0.01
    and l_quantity < 24; -- QUANTITY在区间[24, 25]中随机选择

-- Q7
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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
select
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

执行完毕后，可通过当前 SQL Editor 的运行历史查看本次任务的运行耗时。
![](.topwrite/assets/image_1716953511204.png)

如果您希望进行性能测试，可连续执行2次以上的查询，以便计算集群能够充分Cache数据发挥最佳性能。同时，云器 Lakehouse 也提供了系统主动缓存（Cache）功能，本教程暂不展开这部分介绍。以下是第二次运行时，计算集群缓存（Cache）数据后的运行结果，较第一次无缓存时性能有明显提升。
![](.topwrite/assets/image_1716954084738.png)

如果希望查看 22 个查询中每个查询的执行详情，可通过访问“计算 → 作业历史”，根据查询标签“tpch100g_benchmark”对查询历史进行过滤后查看。
![](.topwrite/assets/image_1716285600039.png)

## Step03. 扩大集群规格，再次对样例数据进行 TPC-H 的查询

通过“计算 → 集群”管理页面，您可以修改刚才创建的测试集群的规格大小，例如从 M 修改为 L，L 规格是 M 规格的 2 倍。
![](.topwrite/assets/tpch_vc_edit_to_L.png)

或者在SQL脚本中执行以下命令进行修改：

```sql
-- 修改集群大小
alter vcluster TPCH_100GB SET VCLUSTER_SIZE = 'LARGE';
```

修改后，使用调整大小后的集群再次进行查询测试。
![](.topwrite/assets/image_1716954399887.png)
新扩容的计算节点在数据被充分缓存（Cache）后，性能会继续提升。
![](.topwrite/assets/image_1716954453780.png)
![](.topwrite/assets/image_1716954471528.png)

通过作业的运行时间可以观察到，在相同的数据规模和查询任务下，扩大计算集群规格后，任务的总体运行时间大幅缩短。在两次执行后，随着数据被缓存，查询性能得到进一步提升。

# 了解和使用Result Cache

## 简介

云器 Lakehouse 使用缓存技术来提升查询性能和效率。平台提供了三种类型的缓存来提高查询性能：

1. 查询结果缓存（Result Cache）
2. 元数据缓存（Metadata Cache）
3. 虚拟集群本地缓存（Virtual Cluster Local Disk Cache）

    ![](.topwrite/assets/image_1713780513737.png)

其中：

* 元数据缓存和查询结果缓存服务从属于服务层，可在工作空间内共享。
* 虚拟集群本地缓存保存在集群本地节点，仅在使用指定虚拟集群时才能使用其本地缓存。

本文将介绍查询结果缓存的工作原理及其使用方式。

## 结果缓存

在云器 Lakehouse 中执行查询时，符合一定条件的查询结果会自动保留一段时间，并在该时间段结束后被清除。这部分临时存储的查询结果称为查询结果缓存。

查询结果缓存（Result Cache）需要满足以下条件才能被复用：

* 查询中使用的表的基础数据未发生改变。如果查询中使用的任何表中的数据发生更改，则无法复用结果缓存；
* 查询中没有包含对视图的引用。如果查询对象中包含视图，则不支持保留查询结果缓存；
* 新发起的 SQL 查询语句在语法上能够和先前执行过的查询精确匹配；
* 查询中不包含非确定性函数（例如：CURRENT_TIMESTAMP()）或用户定义函数 (UDF)；
* 先前的Result Cache未过期删除。

## 结果缓存的过期周期

结果缓存成功后，默认保留周期为24小时。

在 24 小时内，若有后续查询复用了该结果缓存，则其过期时间将额外延长 24 小时。否则，24 小时后，该查询结果缓存将被清除。

## 启用与禁用结果缓存

使用 `cz.sql.enable.shortcut.result.cache` 参数在 SESSION 级别启用或禁用，如下所示。

```Python
--开启结果缓存
set cz.sql.enable.shortcut.result.cache=true;

--关闭结果缓存
set cz.sql.enable.shortcut.result.cache=false;
```

注：当前（2024 年 04 月）Lakehouse 版本的查询结果缓存（Result Cache）功能处于公测阶段，默认未开启，后续版本将默认开启。

## 约束与限制

缓存保留周期：24小时。

单个工作空间支持缓存的作业数量上限：10万。

结果缓存大小限制：无限制。小于等于10MB的结果将缓存在管控层内存Cache，超过10MB的结果将持久化在存储层（对象存储文件）。

不支持包含非确定性函数、UDF 的查询结果缓存。

## 结果缓存演示

为了演示查询结果缓存，首先启用结果缓存并在云器 Lakehouse 中执行一个 SQL 查询。然后重新运行相同的查询，以验证新查询是否通过重用结果缓存实现了加速。

```Sql
 --开启结果缓存
set cz.sql.enable.shortcut.result.cache=true;

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
        tpch_100g_new.lineitem
where
        l_shipdate <= date '1998-12-01' - interval '85' day
group by
        l_returnflag,
        l_linestatus
order by
        l_returnflag,
        l_linestatus
;
```

第一次执行花费了12.1秒。通过Job Profile查看作业运行信息，作业从磁盘读取了大量数据。

![](.topwrite/assets/4590d8b1-4fd3-45b6-abd2-816d8ca58242.png)

第二次执行该查询时，作业复用了上次查询的结果缓存，在 15 ms 内返回了结果。
![](.topwrite/assets/result_cache_query_output.png)
![](.topwrite/assets/383621f0-27c0-4f17-b217-0c0ad3bbc686.png)
查看作业的 Job Profile 时，可在诊断页面的执行计划图中看到作业使用了“JOB RESULT REUSE”，说明作业直接查询了结果数据。
![](.topwrite/assets/image_1713780060450.png)

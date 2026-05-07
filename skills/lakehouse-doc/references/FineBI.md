# 通过帆软BI分析云器Lakehouse里的数据

帆软BI（FineBI） 是帆软软件有限公司推出的一款商业智能（Business Intelligence）产品。

FineBI 是新一代大数据分析的 BI 工具，旨在帮助企业的业务人员充分了解和利用他们的数据。FineBI 凭借强劲的大数据引擎，用户只需简单拖拽便能制作出丰富多样的数据可视化信息，自由地对数据进行分析和探索，让数据释放出更多未知潜能。

## 准备工作

### 下载和安装帆软BI

请参考[FineBI官网](https://www.finebi.com/)，如果已经安装完毕请跳过。

### 下载云器Lakehouse JDBC驱动

请参考云器Lakehouse [JDBC驱动](JDBC-Driver.md)。

将JDBC的最新版本下载到本地供后续使用。

### 修改SystemConfig.driverUpload允许上传Jar包

由于大部分用户对工程安全性要求很高，FineBI 默认禁止通过驱动管理上传驱动。

因此使用驱动管理前，需要将储存 FineBI 信息的 [FineDB](https://help.fanruan.com/finebi/doc-view-1080.html) 数据库的 fine\_conf\_entity 表中字段 SystemConfig.driverUpload 设置为 true 

* 更改参数值为 true ：允许通过驱动管理上传驱动
* 更改参数值为 false：（默认状态下参数值为false）禁止通过驱动管理上传驱动。上传时会报错：不允许上传驱动jar包，可以修改SystemConfig.driverUpload配置值开启该功能。



:-: ![](.topwrite/assets/image_1736994756848.png =672)



详细请参考[这里](https://help.fanruan.com/finebi/doc-view-1540.html)。

重启后再次登录 FineBI 系统，即可通过「驱动管理」上传驱动。

## 在帆软BI里安装云器Lakehouse JDBC驱动

用户可使用「驱动管理」功能，上传对应的驱动。「驱动管理」使用的是热加载，上传驱动后不需要重启 FineReport 即可直接使用驱动 。

当遇到一些驱动导致的问题后，可以快速修改驱动加载方式从而能够实现快速的连接。

导航到数据连接->数据连接管理：

^

:-: ![](.topwrite/assets/image_1736937201539.png =320)

^

点击驱动管理->新建驱动。

默认选优先加载当前上传驱动，如下图所示：

^

:-: ![](.topwrite/assets/image_1736936446966.png =698)

* 优先加载当前方式上传驱动：先加载驱动管理的 jar。
* 仅加载当前方式上传驱动：仅加载驱动管理的 jar。

安装云器Lakehouse JDBC驱动程序的时候请选择“仅加载驱动管理的 jar”。

驱动名称请填写“云器Lakehouse”。
驱动请选择“com.clickzetta.client.jdbc.ClickZettaDriver”。

## 使用驱动

1）在「数据连接管理」界面点击「新建数据连接」，新建一个 云器Lakehouse 数据连接。
先选择数据连接类型为其他->其他JDBC：

^

:-: ![](.topwrite/assets/image_1736937496339.png =684)

^

2）驱动选择「自定义」，在后方下拉选择刚刚上传的云器Lakehouse 驱动 ，并填入连接信息，如下图所示：

:-: ![](.topwrite/assets/image_1736938479094.png =676)

^

* 数据连接URL：
  jdbc\:clickzetta://你的实例ID.\<region\_id>.api.clickzetta.com/你的workspace名称?virtualCluster=你的集群名称\&schema=你的数据库schema名称\&username=用户名\&password=密码

在云器Lakehouse里，导航到工作空间，找到你需要访问的工作空间，然后点击复制即可将JDBC URL连接串进行复制。然后在复制到字符串按上述格式添加上用户名和密码。

^

![](.topwrite/assets/image_1736939576798.png)

^

* 校验语句请输入：
  set cz.sql.double.quoted.identifiers=true;
  select 1;
* 请它参数请保持不变。

3）点击测试连接，可以看到数据库可以成功连接，如下图所示：

^

:-: ![](.topwrite/assets/image_1736937895239.png =664)

^

## 验证连接

### 通过创建服务器数据集

导航到数据连接->服务器数据集，创建新的SQL数据集。

数据集名称：云器Lakehouse-TPCH-Q01

SQL语句：

```sql
--LAKE_HOUSE SQL
--********************************************************************--
--查询lineItems的一个定价总结报告。在单个表lineitem上查询某个时间段内，对已经付款的、
--已经运送的等各类商品进行统计，包括业务量的计费、发货、折扣、税、平均价格等信息。
--********************************************************************--
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
    l_linestatus
limit 1;
```

点击预览，结果如下表名数据连接可用。

^

:-: ![](.topwrite/assets/image_1736938941276.png =657)

### 通过创建公共数据

选择新建数据集->SQL数据集：

^

:-: ![](.topwrite/assets/image_1736939075914.png =660)

表明云器Lakehouse里的表对帆软BI的“公共数据”可用。

在分析主题中使用Lakehouse里的数据：

^

:-: ![](.topwrite/assets/image_1736939239963.png =657)

^

### 通过分析视图

通过拖拉拽生成新的数据视图

:-: ![](.topwrite/assets/image_1736994382813.png =660)

^

基于数据视图的可视化组件-饼图，分析不同发动机类型的二手车销售额

^

:-: ![](.topwrite/assets/image_1736994510861.png =665)

^

基于数据视图的可视化组件-交叉表，分析不同发动机的二手车逐年销售额

^

:-: ![](.topwrite/assets/image_1736994646263.png =669)

^

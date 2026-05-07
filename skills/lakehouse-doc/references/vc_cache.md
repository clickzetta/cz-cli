# 计算集群缓存

Lakehouse使用缓存技术来加速查询性能和效率。平台提供了三种类型的Cache来提高查询性能

1.查询结果缓存(ResultCache)

2.元数据缓存(MetadataCache)

3.计算集群本地缓存 (Virtual Cluster Local Disk Cache)

![](.topwrite/assets/image_1729739810389.png)

其中:

元数据缓存和查询结果缓存服务从属于服务层,可在工作空间内共享。

计算集群缓存本地缓存保存在集群本地节点,仅在使用指定虚拟集群时可以使用其本地缓存。

在 Lakehouse 的存算分离架构中，数据存储在对象存储上。为了应对网络请求延迟并提升分析场景的响应速度，我们采用了缓存策略。计算集群缓存将频繁访问的数据存储在本地节点，从而加速查询。

计算集群缓存分为两种：

1. **主动缓存**：通过命令手动将表缓存到计算集群。每次计算集群启动时，会自动加载这些预缓存的表最新写入的数据或者分区。目前仅支持 AP 型集群。适用场景如 BI 报表查询，可以显著减少查询延迟，提高数据处理速度。
2. **被动缓存**：在首次查询时，Lakehouse 自动将读取的文件缓存到计算集群。后续包含相同表文件的查询将直接利用缓存，加速查询过程。支持 GP 型和 AP 型集群。第二次及以后的查询，如果涉及到首次缓存的表，将直接命中缓存。

## 使用方式

1. **主动缓存表方式**：

```SQL
ALTER VCLUSTER default SET PRELOAD_TABLES="schema1.table1,schema2.table2";
```

如果需要添加新表到缓存,需要将已添加的表都带上否则会将原来的覆盖：

```SQL
ALTER VCLUSTER default SET PRELOAD_TABLES="schema1.table1,schema2.table2,schema3.table3";
```

## **查看缓存状态**：
当使用 `ALTER..PRELOAD_TABLES` 命令将表加载到计算集群时，SHOW PRELOAD显示的缓存状态的更新可能会存在延迟，但是实际上缓存表已经生效。通常情况下，这种延迟大约为 10 分钟。


* 显示当前虚拟集群的预加载表/分区状态：

```SQL
SHOW PRELOAD CACHED STATUS;
```

* 显示指定虚拟集群的预加载表/分区状态：

```SQL
SHOW VCLUSTER preload_ap_vc_test PRELOAD CACHED STATUS;
```

* 通过表名过滤预加载状态信息：

```SQL
SHOW VCLUSTER preload_ap_vc_test PRELOAD CACHED STATUS WHERE table LIKE '%x_test';
```

* 显示虚拟集群的预加载缓存汇总信息：

```SQL
SHOW EXTENDED PRELOAD CACHED STATUS;
```

## 注意事项

* 集群支持自动启停，当集群停止时，缓存的表将自动释放。在 AP 型集群中，重新启动时只会缓存最新写入的数据或者分区。
* 执行缓存命令后，只有新写入的数据才会被缓存
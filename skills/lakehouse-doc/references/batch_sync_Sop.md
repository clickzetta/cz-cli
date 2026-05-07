## 任务计费

### 问题：数据同步任务如何收费？

回答:数据同步任务的费用，整体分为硬件资源使用费用、数据传输网络费用两大类构成。

* 硬件资源使用费用依据同步型计算集群的规格和使用时长进行按量计费，集群未使用或被停止后，不再收取费用。
* 数据传输网络费用按实际情况收取：当使用数据集成等功能，批量从Lakehouse通过公网下载、导出数据时，会产生Internet网络传输费用。Internet网络传输以实际产生的传输数据量进行计量并计算费用。从其他数据源通过Internet网络向Lakehouse上传数据所产生的网络传输流量，不收取网络传输费用。若使用专线、Private Link或其他网络产品实现跨云厂商、跨地域或跨VPC网络打通，网络打通本身会产生费用。这部分费用根据网络打通方式的不同，在云器Lakehouse侧产生的由云器收取，在云平台账号中产生的费用由云平台直接收取。
* 详见：[计费说明](pricing.md)

## 数据源

### 问题：离线同步当前支持的数据源有哪些？

回答:在任务配置页面，进行源端和目标端选择时，会完整列出已支持的数据源类型。若没有可用的数据源，请点击「+」号按钮先前往新建，之后再使用。离线同步的数据源之间可以两两自由组合，来构建丰富的同步链路。详见：[数据源管理](config-datasource.md)

^

### 问题：离线同步如何验证数据源的可访问？

回答:数据源列表中的「测试连通」功能（数据源配置页面也提供该功能），可用于测试数据同步任务环境与数据源之间的访问连通状况。若测试结果显示连通失败，则需检查配置的准确性（如连接串地址、用户名和密码等）以及网络状况。若存在网络不通的问题，可查阅下文的网络连通性章节，其中给出了相应的解决方案。

^

## 网络联通

### 问题：如果数据源端在VPC环境下，如何打通数据同步的网络连通性？

回答:如果数据源在VPC环境下，默认情况下数据同步任务所在的网络环境是无法访问联通的。可以通过以下几种方式来打通：

* 在源端启用允许公网访问、在数据源中配置公网访问的地址。
* 使用SSH Tunnel：[数据源管理](config-datasource.md)&#x20;
* 使用Private Link：
* Private Link和SSH相结合：[通过Private Link和SSH结合来同步VPC内的RDS数据](StudioDI_PrivateLinkVPC_fromRDS.md)

### 问题：如果源端数据库有白名单限制，如何才能确保数据同步任务可连通该数据源？

回答:需将数据同步服务出口IP地址添加至源端的白名单中，不同服务地域的IP地址存在差异，具体地址和配置方式详见：[数据源IP白名单配置指南](datasource_ip_whitelist.md)

## 任务配置

### 问题：离线同步任务配置的主要流程是怎样的？

回答:主要分为数据源创建、来源和目标选择、配置字段映射、并发和脏数据管理等同步规则配置（可选）这几个步骤。配置完成后可手动触发运行测试，随后提交周期定时调度。详见：[离线同步](batch_sync.md)

^

### 问题：如果要控制数据同步时对源端的压力，需要如何配置？

回答:在离线同步任务「同步规则配置」区域，可以通过最大并发数和同步速率两个配置项来分别控制对源端的连接数和读取访问的压力。并发数和同步速率越大、对源端的压力越大。

^

### 问题：如果源端数据中存在“脏数据”的情况，需要如何处理？

回答:在离线同步任务「同步规则配置」区域，可以通过「任务遇脏数据自动结束」和「收集脏数据」两个配置项来控制同步任务对脏数据的处理行为。这些「脏数据」不会被写入到目标端。「脏数据」主要指无法正常写入到目标端的数据，最常见的情况是字段类型不匹配，比如把String类型的字段取值写入到目标INT字段中。

* 「任务遇脏数据自动结束」配置成「是」，那么，在脏数据达到对应的条数时任务会失败退出。
* 「任务遇脏数据自动结束」配置成「否」，那么，即使有脏数据，任务也会继续执行，不会自动退出。
* 「收集脏数据」选项会控制是否把脏数据收集起来，在任务运行完成后进行查看。脏数据最多收集1000行数据，最长保存7天。

^

## 报错排查

### 问题：任务运行报错 `java.lang.OutOfMemoryError: Java heap space`如何解决？

原因：通常由于读取的数据中存在较大的字段或行，或者对于支持批量读取数据的数据源，单个批次内同步的数据量较大，超过了同步任务的计算进程的堆内内存。

解决：可通过调整同步任务计算集成内存解决，在任务开发-高级参数中添加参数`taskmanager.memory.process.size`，有效单位m、g，默认1600m

^

### 问题：任务运行报错 `java.lang.OutOfMemoryError: Direct buffer memory`如何解决？

原因：同步任务计算集成的堆外内存不足，通常可能是以下原因：

* 来源数据中中存在较大的字段或行，或者对于支持批量读取数据的数据源，单个批次内同步的数据量较大，且来源数据源会使用堆外内存作为数据缓存，如elasticsearch
* 目标数据源使用堆外内存攒批发送数据，如Lakehouse，由于一批数据中存在较大行导致某个批次数据超过攒批缓存大小

解决：通常有以下解决方案：

* 参照堆内存超限解决方案，调整`taskmanager.memory.process.size`参数
* 单独调整任务堆外内存的大小，调整`taskmanager.memory.task.off-heap.size `参数，如256m，或512m
* 如果数据源支持设置batch size，可适当调小配置值，**但注意，这可能会导致同步效率降低**

### 问题：任务运行报错 `CZLH-67000:Out of Memory undefined: could not allocate block of size 262KB (1.0GB/1.0GB used)`，如何解决？

原因: 底层存储索引数据时默认最大是1G, 如果表数据过多的情况下, 会出现pk数据操作了限制范围

解决:

* 如果是单表离线同步的话, 建议重新建表, 并且在建表时加上`cz.storage.art.max.memory.size.bytes`参数, 具体设置多大, 建议根据表实际大小来按需设置。
* 如果是多表实时的全量同步报错的话，需要在任务的高级参数中加入`lh.table.cz.storage.art.max.memory.size.bytes`，重新提交任务并启动。

### 问题：任务运行报错 `entity content is too long [320177567] for the configured buffer limit [104857600]`，如何解决？

原因：es 读取数据是通过http 请求批量读取的。es http buffer 有大小限制，默认值是100MB，如果批量的数据大小超过这个限制，则会报错；

解决：

* 降低批量读取的batchSize；
* 添加高级参数，调大http buffer的大小限制：studio.connector.es.buffer_limit；

说明：降低batchSize会略微降低同步效率，调大studio.connector.es.buffer_limit 则会增加任务使用内存；

### 问题：任务运行报错 `The maximum buffer size of 16777216 is insufficient to read the data of a single field. This issue typically arises when a quotation begins but does not conclude within the confines of this buffer's maximum limit.`，如何解决？

原因：数据集成使用的第三方CSV SDK去读取解析CSV数据，SDK会对数据批量读取，对数据大小有限制，buffer大小默认是16MB；

解决：

添加高级参数：studio.connector.csv_reader.max\_buffer\_size；支持带MB/GB的写法，比如：32MB；

说明：该参数目前仅在OSS/S3 生效；

### 问题：任务运行报错 `Field at index 0 in record starting at line 1 exceeds the max field size of 16777216 characters`，如何解决？

原因：数据集成使用的第三方CSV SDK去读取解析CSV数据，SDK对数据单个字段大小有限制，默认是16MB；

解决：

添加高级参数：studio.connector.csv_reader.max\_field\_size；支持带MB/GB的写法，比如：32MB；

说明：该参数目前仅在OSS/S3 生效；

### 问题：任务运行报错 `Field at index 5 in record starting at line 1 exceeds the max record size of 67108864 characters`，如何解决？

原因：数据集成使用的第三方CSV SDK去读取解析CSV数据，SDK对单条数据大小有限制，默认是64MB；

解决：

添加高级参数：studio.connector.csv_reader.max\_record\_size；支持带MB/GB的写法，比如：128MB；

说明：该参数目前仅在OSS/S3 生效；

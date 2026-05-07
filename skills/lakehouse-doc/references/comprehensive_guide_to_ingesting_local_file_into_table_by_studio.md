# 将数据导入云器Lakehouse的完整指南

## 数据入仓：通过云器Lakehouse Studio 加载本地文件

#### 概述

您将使用[云器Lakehouse Studio](https://accounts.clickzetta.com/)来基于WEB界面操作、以无代码的方式来加载本地数据到云器Lakehouse的表中。

#### 使用场景

适合较小（不大于2GB）的本地文件（CSV、TXT、Parquet、AVRO、ORC）直接上传到云器Lakehouse的表中，无需编程实现，实现方式最简单。

#### 实现步骤

##### 上传文件

导航到数据->数据目录，单击“上传数据”，导入本地文件（测试数据生成章节生成的CSV文件）到表中。

:-: ![](.topwrite/assets/image_1736146842294.png =519)

##### 导入数据

点击“上传数据”：

* 测试数据生成章节生成的测试数据
* 云器Lakehouse设置章节创建的Schema
* 选择新建表，表名为：lift\_tuckets\_import\_by\_studio\_web
* 云器Lakehouse设置章节创建的虚拟计算集群

:-: ![](.topwrite/assets/image_1736146857816.png =513)

点击“下一步”后，检查上传数据自动设置项是否正确，如果数据预览符合预期，则自动设置正确，点击“确认”即可完成数据上传。

:-: ![](.topwrite/assets/image_1736146867287.png =516)

##### 结果校验

进入“数据”查看导入状态和数据：

可以看到导入数据的结果里，写入行数为“100,000”，这个在“测试数据生成”步骤生成的数量一致。

:-: ![](.topwrite/assets/image_1736146881028.png =523)

可以进一步“预览数据”，确认数据加载成功：

:-: ![](.topwrite/assets/image_1736146888569.png =518)

至此，我们通过云器Lakehouse Studio 加载本地文件到表中。

:-: ![](.topwrite/assets/image_1736146899159.png =515)

#### 下一步建议

* 继续加载数据到同一张表中或者其它表中。通过在上个页面的“上传”，可以上传更多数据到同一张表中。
* 通过云器Lakehouse自带的DataGPT进行可视化数据探索、以问答方式进行数据分析。
* 在云器Lakehouse Studio的IDE里开发SQL任务，进一步清洗和转换数据，分析数据。

#### 资料

[数据源](DataSourceConfigGuide.md)

[数据同步](data-integration.md)

^

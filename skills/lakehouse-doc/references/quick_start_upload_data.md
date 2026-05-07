# 入门指南：如何快速上传导入本地数据

## 适用场景

Lakehouse提供了一体化的引擎来支持数据的处理加工分析，以SQL作为开发语言。本文概要介绍如何通过Lakehouse Studio的任务开发功能模块，快速编写和运行一条SQL语句来进行数据的查询分析。

## 前置阅读

在阅读本指南之前，建议完成以下文档的阅读和理解：

* [Lakehouse 产品简介](what_is_clickzetta_lakehouse.md)
* [产品基本概念](Key_Concepts.md)
* [Lakehouse Studio 快速导览](LakehouseStudioTour.md)

## 操作指南

您可以通过Lakehouse Studio界面上提供的「数据上传」功能向Lakehouse的表中添加数据。

### 使用说明

* 适合较小（不大于2GB）的本地文件（CSV、TXT、Parquet、Avro、ORC）直接上传到云器Lakehouse的表中，无需编程实现，方式最简单。
* 当前仅支持一次上传一个文件。
* 数据上传功能暂不支持对文件中的struct、map、array这三个数据类型的字段解析。
* 需要具备 `工作空间管理员角色（workspace_admin）`、`工作空间开发角色(workspace_dev)` 或 `数据分析师（workspace_anylst）` 权限的用户，才能使用数据上传的功能。

### 操作步骤

1. 登录云器Studio账号

2. 在如下地方均可以点击「上传数据」

   * 实例首页
     ![](.topwrite/assets/image_1747999086635.png)
   * 开发->数据树
     ![](.topwrite/assets/image_1749035410382.png)
   * 数据资产地图
     ![](.topwrite/assets/image_1749035355497.png)
   * 数据资产地图->数据管理
     ![](.topwrite/assets/image_1749035495163.png)

3. 点击后，会有如下弹框。可将本地文件通过拖拽，或者点击浏览本地系统上的文件的方式添加进来。一次只能添加一个文件，且大小不得超过2GiB。您可以使用本样例文件来尝试上传：:attachment[walmart.csv]{src=".topwrite/assets/walmart.csv" size="363.73 kB"}。

   ![](.topwrite/assets/image_1749035813956.png =380)

4. Schema：选择将表创建在某个schema下。

5. 选择表：选择「新建表」并在后方输入新建表名。

6. 集群：当前Schema所在的工作空间下的可用集群。

7. 数据导入方式：支持追加写入，和先清空后写入两种方式导入数据至新建表中。

8. 信息全部确认后，点击“下一步”，系统会基于已上传的文件信息，自动解析出文件中的字段信息，如下图所示。
   ![](.topwrite/assets/image_1749035692218.png =380)

9. 检查并判断自动解析出来的字段名称和字段类型等信息是否符合预期，确认无误后，点击「确认」即可完成新建表并上传数据的操作。
   * 若发现字段解析有问题，可通过修改**文件属性**配置项，重新刷新获取自动解析后的字段名称、字段类型等信息。或自行修改字段名称或字段类型。
   * 注意：修改后的字段类型有可能因与系统解析的不匹配，导致无法上传成功。

## 相关文档

* 您可以阅读 [使用数据上传功能上传数据](upload_data.md) 的帮助文档来了解更多数据上传方式，比如上传数据到已有表中。
* 您可以阅读 [将数据导入Lakehouse的完整指南](a_comprehensive_guide_to_ingesting_data_into_clickzetta_lakehouse.md) 来了解更多的将数据导入到Lakehouse中的方式。

## 下一步建议

* 完成数据上传之后，可以参考[如何快速运行一条SQL](quick_start_sql_query.md)的指南文档，基于表中的数据进行查询分析。

^

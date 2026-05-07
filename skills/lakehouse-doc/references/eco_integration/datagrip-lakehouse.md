# DataGrip连接云器Lakehouse

本文档将指导您如何使用数据库管理工具DataGrip连接云器Lakehouse，以便进行高效的数据管理操作。

## 背景信息

DataGrip 是一款功能强大的商业版数据库管理工具，专为满足专业 SQL 开发人员的特定需求而设计。它支持多种数据库，包括云器Lakehouse。有关DataGrip的更多信息，请访问[官方网站](https://www.jetbrains.com/datagrip/)。

## 前提条件

在开始操作之前，请确保您已满足以下条件：

1. 已成功开通Lakehouse服务。
2. 已下载适用于Lakehouse的JDBC驱动程序。请参考[官方文档](../version-update)以获取驱动程序。
3. 已下载并安装DataGrip。

## 步骤一：添加云器Lakehouse驱动

1. 打开DataGrip，进入主界面。
2. 点击“New Project”，创建一个新的项目。在新项目的界面中，点击“Driver”并选择“+”按钮，添加一个新的驱动。将驱动命名为Lakehouse
![添加Lakehouse驱动](.topwrite/assets/image_1693482390581.png)




## 步骤二：使用DataGrip连接云器Lakehouse

1. 在“Data Sources”窗口中，选择刚刚创建的Lakehouse数据源。
2. 点击“Test Connection”按钮，确保连接正常。如果连接失败，请检查您的Lakehouse服务和JDBC驱动设置。
3. 点击“OK”按钮，完成数据源配置。
4. 从Lakehouse服务的首页，复制JDBC连接字符串。请参考以下示例：

![Lakehouse首页JDBC地址](.topwrite/assets/image_1693482409292.png)

## 步骤三：使用DataGrip管理云器Lakehouse

1. 在DataGrip的左侧“Database”面板中，您可以看到所有的schema和table。

![查看schema和table](.topwrite/assets/image_1693482418469.png)

2. 右键点击任意一个schema或table，选择“SQL Script”以打开SQL编辑器。
3. 在SQL编辑器中，您可以编写和执行SQL查询。例如，您可以执行以下查询以获取某个表的前10行数据：

```sql
SELECT * FROM your_table_name LIMIT 10;
```

4. 执行查询后，结果将在下方的“Results”面板中显示。您可以对结果进行排序、筛选和导出等操作。

# 常见问题
由于datagrip不同版本会存在不同的变化。有的版本点击预览表时发送SQL在schema会带上引号。您可以通过以下方式绕过，编辑数据源在options中的startup script添加,并且勾选Single session mode
```
set  cz.sql.double.quoted.identifiers=true;
```

![](../.topwrite/assets/image_1733814698645.png)
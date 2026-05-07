# DBeaver连接云器Lakehouse

本文档将指导您如何通过数据库管理工具DBeaver连接并管理云器Lakehouse中的数据。DBeaver是一款功能强大的多平台数据库工具，适用于开发人员、数据库管理员、分析师以及所有需要使用数据库的人员。本文档将详细介绍如何配置DBeaver以连接Lakehouse，并提供一些实际使用示例。

## 背景信息

DBeaver是一款免费的数据库管理工具，支持多种数据库，如MySQL、PostgreSQL、Oracle等。更多DBeaver信息，请参见[DBeaver官网](https://dbeaver.io/)。

## 前提条件

在开始操作前，请确保您已满足以下条件：

1. 已成功开通Lakehouse服务。
2. 已下载适用于Lakehouse的JDBC驱动。关于如何下载和安装驱动，请参见[Java SDK文档](<../version-update.md>)。
3. 已下载并安装DBeaver。关于如何下载和安装DBeaver，请参见[DBeaver下载页面](https://dbeaver.io/download/)。
4. 已安装适用于您的操作系统的DBeaver版本。本文中的DBeaver示例为`dbeaver-ce-23.1.4-macos-x86_64`。

## 步骤一：配置DBeaver连接Lakehouse驱动

1. 启动DBeaver并进入主界面。在顶部菜单栏中，点击“数据库”->“驱动管理器”。

![驱动管理器界面](.topwrite/assets/image_1693482257812.png)

2. 在驱动管理器界面中，点击左下角的“新建驱动”按钮。

![新建驱动按钮](.topwrite/assets/image_1693482268306.png)

3. 在弹出的对话框中，点击“设置”按钮，填入以下信息：
   - 驱动名称：`Clickzetta`
   - 类名：`com.clickzetta.client.jdbc.ClickZettaDriver`
   - URL模板：`jdbc:clickzetta://{instanceName}.{service}/{workspaceName}?virtualCluster={您的Virtual Cluster名称}`

![配置驱动信息](.topwrite/assets/image_1693482279541.png)

4. 点击“选择库”，将已下载的Lakehouse JDBC驱动（`*.jar-with-dependencies.jar`）添加到驱动中，并点击“确定”。

![添加JDBC驱动](.topwrite/assets/image_1693482290529.png)

5. 在顶部菜单栏中，点击“新建连接”，选择“全部”，在搜索框中输入刚才新建的驱动名称`Clickzetta`，然后点击“下一步”。

![新建连接](.topwrite/assets/image_1693482299012.png)

6. 在“连接配置”界面中，选择“URL”，从Lakehouse首页复制JDBC连接字符串并粘贴到相应的输入框中。同时，填写您的用户名和密码。

![连接配置](.topwrite/assets/image_1693482307635.png)

关于如何获取Lakehouse首页的JDBC连接字符串，请参见[Lakehouse文档](<../version-update.md>)。

## 步骤二：使用DBeaver查询分析Lakehouse数据

成功连接DBeaver和Lakehouse后，您可以在DBeaver左侧的“连接”面板中找到新建的Lakehouse连接。接下来，您可以通过SQL管理Lakehouse中的数据。

1. 右键点击新建的Lakehouse连接，选择“新建SQL编辑器”。

![新建SQL编辑器](.topwrite/assets/image_1693482322444.png)

2. 在SQL编辑器中，编写您需要执行的查询语句。例如，查询某个表的前10条记录：

```sql
SELECT * FROM your_table_name LIMIT 10;
```

![编写查询语句](.topwrite/assets/image_1693482333626.png)

3. 执行查询，并查看结果。您还可以对查询结果进行排序、筛选等操作。

通过以上步骤，您可以轻松地使用DBeaver连接并管理Lakehouse中的数据。更多关于DBeaver的高级功能和使用技巧，请参见[DBeaver官方文档](https://dbeaver.io/docs/)。
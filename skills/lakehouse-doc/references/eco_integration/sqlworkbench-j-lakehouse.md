# SQL Workbench/J 连接云器 Lakehouse

云器 Lakehouse 为您提供了一种便捷的途径，可通过数据库管理工具 SQL Workbench/J 来访问和管理 Lakehouse 中的数据。本文档将详细介绍如何使用 SQL Workbench/J 连接云器 Lakehouse，并提供一些实用的操作示例。

## 背景信息

SQL Workbench/J 是一款免费的、跨平台的 SQL 查询工具，采用 Java 语言编写，适用于所有提供 Java 运行环境的操作系统。

## 预备条件

在开始操作前，请确保您已满足以下条件：

- 已安装 Java 11 版本。
- 已开通 Lakehouse 服务。
- 已下载[Lakehouse JDBC驱动](<../version-update.md>)。
- 已下载并安装 [SQL Workbench/J](https://sql-workbench.eu/download-archive.html)。本文以 SQL Workbench/J Build 128 为例。

## 步骤一：启动 SQL Workbench/J

1. 为确保 SQL Workbench/J 正常运行，需要在环境变量中添加 `JDK_JAVA_OPTIONS=--add-opens=java.base/java.nio=ALL-UNNAMED`。请注意，仅当您使用的是 Java 1.8 或更低版本时，才需要修改此参数。由于 SQL Workbench/J Build 128 要求使用 Java 11，因此必须进行此修改。
2. 在 Linux 系统下，通过执行 `sh sqlwbconsole.sh` 命令启动 SQL Workbench/J。对于 Windows 系统，直接点击 `SQLWorkbench64.exe` 即可启动。

## 步骤二：添加云器 Lakehouse 驱动

1. 启动 SQL Workbench/J 后，系统会自动弹出 “Select Connection Profile” 对话框。如果没有弹出，请点击 “Driver” 菜单，选择 “Manage Drivers”。
2. 在 “Manage Drivers” 对话框左下角，点击 “Add Driver” 按钮，创建一个新的驱动。输入自定义驱动名称，并上传已下载的云器 JDBC 驱动 JAR 包。完成后，点击 “OK” 按钮，完成驱动配置。请注意，上传 Lakehouse JDBC 驱动后，将 “Classname” 配置为 `com.clickzetta.client.jdbc.ClickZettaDriver`。

![添加驱动界面](.topwrite/assets/image_1693482142270.png)

## 步骤三：SQL Workbench/J 连接云器 Lakehouse

1. 在 “Select Connection Profile” 对话框右侧的 Profile 配置界面，选择刚刚创建的云器驱动，并从云器 Lakehouse 控制台首页复制 JDBC 连接字符串。

![选择驱动界面](.topwrite/assets/image_1693482159154.png)

![Lakehouse首页JDBC地址](.topwrite/assets/image_1693482172849.png)

2. 在 Profile 配置界面的 “Connection” 选项卡中，粘贴刚刚复制的 JDBC 连接字符串。如有需要，您还可以在 “Advanced” 选项卡中设置其他连接参数，如 SSL、最大连接数等。

## 步骤四：使用 SQL Workbench/J 管理云器 Lakehouse

1. 连接成功后，您可以在左侧对象浏览器中查看所有的 schema 和 table。

![查看schema和table](.topwrite/assets/image_1693482182988.png)

2. 在右侧的 SQL 编辑器中，您可以编写并执行 SQL 查询。例如，尝试执行以下查询以查看某个表的数据：

```sql
SELECT * FROM your_table_name LIMIT 10;
```

3. 您还可以使用 SQL Workbench/J 的导入导出功能，将数据从其他数据源导入到云器 Lakehouse，或将云器 Lakehouse 中的数据导出到其他数据源。

通过以上步骤，您已成功使用 SQL Workbench/J 连接并管理云器 Lakehouse。如有疑问或需要进一步的帮助，请随时联系我们的技术支持团队。
# Tableau连接Lakehouse

Tableau一款商业智能（Business Intelligence）产品。Lakehouse支持数据接入Tableau进行可视化分析，您可以利用Tableau简便的拖放式界面，自定义视图、布局、形状、颜色等，帮助您展现自己的数据视角。本文为您介绍如何通过Lakehouse JDBC驱动，连接Tableau，并进行可视化数据分析。

# 背景信息

Tableau Desktop是Tableau基于斯坦福大学突破性技术研发的软件应用程序，可以帮助您生动地分析实际存在的任何结构化数据，并在几分钟内生成美观的图表、坐标图、仪表盘与报告。更多Tableau Desktop信息，请参见[Tableau Desktop](https://www.tableau.com/products/desktop)。

# 预备条件
在开始操作前，请确保您已满足以下条件：
- 已开通Lakehouse服务。
- 已下载[Lakehouse JDBC驱动](https://www.yunqi.tech/documents/version-update)。
- 已下载并安装[Tableau](https://www.tableau.com/products/desktop/download)。本文以Professional Edition 2024.3.1为例。
- Lakehouse提供的[ Tableau 插件](<https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/tableau-plugin/clickzetta_jdbc-v0.0.1.taco>)
# 连接Lakehouse
## 步骤一：放置Lakehouse JDBC驱动
将下载的Lakehouse [JDBC驱动JAR包](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions)按照操作系统类型放置于Tableau Desktop的对应目录：
- Windows：C:\\Program Files\\Tableau\\Drivers
- macOS：~/Library/Tableau/Drivers
- Linux：/opt/tableau/tableau\_driver/jdbc
## 步骤二：放置Lakehouse的Tableau插件
下载 Lakehouse 提供的[ Tableau 插件](<https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/tableau-plugin/clickzetta_jdbc-v0.0.1.taco>)。该插件是根据 Tableau 官方 [插件文档](https://tableau.github.io/connector-plugin-sdk/docs/package-sign) 编写的。

将下载的插件放置到Tableau Desktop的对应目录
- Windows: C:\\Users\\\[Windows User\]\\Documents\\My Tableau Repository\\Connectors
- macOS: /Users/\[user\]/Documents/My Tableau Repository/Connectors
- Linux: /opt/tableau/connectors
本文案例中使用的是mac，所在的位置为:/Users/xxx/Documents/我的 Tableau 存储库/连接器
## 步骤三：启动Tableau
1. 启动Tableau Desktop。由于上面的插件没有进行数字证书签名因此启动时需要禁止签名校验
 ```
--mac打开命令行运行  
/Applications/Tableau\ Desktop\[version].app/Contents/MacOS/Tableau -DDisableVerifyConnectorPluginSignature=true
-- Windows命令行运行  
tableau.exe -DDisableVerifyConnectorPluginSignature=true 
```
2. 在左侧导航栏的**到服务器**区域，选择**更多... &gt; Lakehouse x 云器科技**。
 ![](.topwrite/assets/af1a476424/45fa8a07085269be5490f751bbe23dcecdb1335f.png)
3. 在Lakehouse x 云器科技,配置参数信息
![](.topwrite/assets/af1a476424/3a4b0c7e6667057f56190550395cf6a845282aa3.png)

| 参数  | 是否必填 | 描述                                       |
| --- | ---- | ---------------------------------------- |
| 服务器 | Y    | 可以在Lakehouse Studio管理-》工作空间中看到jdbc连接串以查看 |
| 用户名 | Y    | 用户名                                      |
| 密码  | Y    | 密码                                       |
4. 单击**登录**，即可进入Tableau Desktop操作界面。
5. 在左侧的架构下拉列表选择目标Lakehouse的Schema。
 ![](.topwrite/assets/af1a476424/a10eb44867352ca69377affd79c8faa77f7f3bf4.png)

## 步骤四：使用Tableau查询及分析数据
本次案例使用公共数据集下的clickzetta\_sample\_data.tpch\_100g.orders 表分析数据

双击新自定义SQL
 ![](.topwrite/assets/af1a476424/ccf42506d4d03632469570fc042ff8d9c84dcc03.png)

输入，点击确定
```SQL
select *  from    clickzetta_sample_data.tpch_100g.orders
```
 ![](.topwrite/assets/af1a476424/cd06ef3dd0b040769d666cafd8278199f2e1f4b3.png)

点击工作表，分析clickzetta\_sample\_data.tpch\_100g.lineitem表中的数据集
![](.topwrite/assets/af1a476424/6c856c2e85e70c074ba137c43ef4bf35f82ce3ec.png)
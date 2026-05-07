# Metabase简介

Metabase是一款开源的商业智能平台，它能帮助您轻松地提出关于数据的问题，并将结果可视化。此外，Metabase还可以嵌入到您的应用程序中，让您的客户能够探索和分析他们的数据。

![Metabase界面示例](.topwrite/assets/image_1704980255033.png)

# 在Docker上部署Metabase

Metabase官方提供了Docker镜像，方便您在任何支持Docker的系统上快速部署。本文档将指导您如何在Docker上部署Metabase，并连接到云器Lakehouse数据库。

## 快速入门

确保您已经安装并运行了Docker。接下来，按照以下步骤在本地运行Metabase的开源版本。

1. 拉取最新的Docker镜像：

   ```
   docker pull metabase/metabase:v0.54.6
   ```

> **注意**：本指南使用 v0.54.6 版本，这是一个经过充分测试的稳定版本。

2. 启动Metabase容器：

   ```

    docker run -d \
      -p 3000:3000 \
      --name metabase \
      metabase/metabase:v0.54.6
   ```

   默认情况下，Metabase服务器将在端口3000上启动。

3. 下载云器Lakehouse的Metabase驱动并复制到Docker容器中：
   [clickzetta.metabase-driver.jar](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/release/clickzetta.metabase-driver.jar)

   ```
docker cp clickzetta.metabase-driver.jar metabase-clickzetta:/plugins/clickzetta.metabase-driver.jar
```

4. 若要在其他端口上运行Metabase，例如端口12345，您可以使用以下命令：

   ```
   docker run -d -p 12345:3000 --name metabase-clickzetta metabase/metabase:latest
   ```

5. 启动完成后，访问 Metabase：`http://localhost:3000`（或您选择的其他端口）。

# 连接云器Lakehouse

## 配置数据库连接

1. 登录到 Metabase，然后进入“Admin Settings”（管理员设置）页面。
2. 在“Databases”（数据库）部分，点击“Add a database”（添加数据库）按钮。
3. 选择云器Lakehouse作为数据库类型。
4. 填写数据库连接信息，包括主机名、端口、数据库名称、用户名和密码等。
5. 点击“Test connection”（测试连接）以确保连接成功。
6. 点击“Save”（保存）按钮完成配置。

![添加云器Lakehouse数据库连接](.topwrite/assets/image_1704980374686.png)

## 浏览和分析数据

1. 在Metabase中，点击左侧导航栏的“Browse Data”（浏览数据）选项。
2. 选择您刚刚配置的云器Lakehouse数据库。
3. 您将看到数据库中的所有表和视图。点击任意表或视图，Metabase将自动为您生成一个数据浏览界面。
4. 您可以对数据进行筛选、排序和分组等操作，以便更好地分析数据。
5. 若要创建更复杂的数据可视化报告，请点击Metabase顶部导航栏的“Create a dashboard”（创建仪表板）按钮，然后选择相应的数据表和可视化类型。

![](.topwrite/assets/img_v3_02as_d2178f6d-8dae-430c-bce4-24714aae31ag.gif)

通过以上步骤，您可以轻松地在Metabase中连接并分析云器Lakehouse数据库中的数据。Metabase提供了丰富的数据可视化选项，帮助您更好地理解和呈现数据。

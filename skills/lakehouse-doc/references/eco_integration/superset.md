# Superset ClickZetta adapter 使用指南

## Superset 简介

Superset 是 Airbnb 开源的 BI 数据分析与可视化平台，原名 Caravel 和 Panoramix。该工具的主要特点包括自助分析、自定义仪表盘、分析结果可视化（导出）以及用户/角色权限控制。Superset 还集成了一个 SQL 编辑器，允许用户进行 SQL 编辑和查询。最初，Superset 主要用于支持 Druid 的可视化分析，但后来发展为支持多种关系数据库和大数据计算框架，如 MySQL、Oracle、PostgreSQL、Presto、SQLite、Redshift、Impala、SparkSQL、Greenplum 和 MSSQL。Superset 基于 Python 框架，集成了 Flask、D3、Pandas 和 SQLAlchemy 等技术。

## Superset ClickZetta 适配器

`clickzetta-sqlalchemy` 是一个为 SQLAlchemy 提供 ClickZetta Lakehouse 的 dialect 适配器，使得使用 SQLAlchemy 接口编写的代码或上层应用可以轻松连接到 ClickZetta Lakehouse。Superset 支持类 SQLAlchemy 规范的 URL 配置数据源链接，因此，在 Superset 中连接 ClickZetta 数据库只需配置相应的 URL 即可。

## 安装与配置

### 使用镜像

通过使用镜像，您可以快速体验 Superset 连接 ClickZetta Lakehouse 的效果：

```shell
docker pull clickzetta/superset:2.1.0-1
docker run -p 8088:8088 clickzetta/superset:2.1.0-1
```

使用浏览器打开 http://localhost:8088。

### 本地安装

1. 安装 `clickzetta-sqlalchemy`：
   `clickzetta-sqlalchemy` 需要在大于等于 Python 3.7 版本的环境下安装。
安装命令（确保当前环境不需要使用 clickzetta-sqlalchemy 和 clickzetta-connector，需要卸载掉以避免依赖冲突）：

```
pip uninstall -y clickzetta-sqlalchemy clickzetta-connector && pip install clickzetta-connector -U
```


2. 安装 Superset：
   您可以选择安装与镜像相同的 Superset 版本，或者安装更高版本的 Superset。
   ```shell
   # 安装与镜像相同的 Superset 版本
   pip install -r https://raw.githubusercontent.com/clickzetta/awesome-clickzetta/main/superset/requirements.txt

   # 安装更高版本的 Superset
   pip install 'apache-superset>=2.1'
   ```

3. 初始化 Superset：
   ```shell
   export FLASK_APP=superset

   superset db upgrade

   # 创建管理员用户
   superset fab create-admin

   superset init

   # 启动服务，绑定在 localhost 的 8088 端口。如需远程访问，可添加 --host 0.0.0.0
   superset run -p 8088 --with-threads --reload --debugger
   ```

## 使用方法

### 登录 Superset

* 如果您使用的是镜像，默认用户名为 `admin`，密码为 `clickzetta`。
* 如果您是本地安装，请使用在安装步骤 `superset fab create-admin` 中填写的用户名和密码。

### 连接 ClickZetta 数据库

1. 点击右上角的 Settings，然后选择 Database Connections，跳转到 Superset 的创建数据库页面。
2. 点击右上角的 Database，选择 Other 作为数据库类型。
3. 填写数据库名称和 ClickZetta Lakehouse 的服务 URL。
4. 点击 TESTING CONNECTION 按钮测试连接是否成功。
5. 如果测试通过，点击下方的 CONNECT 按钮完成数据库连接。

### ClickZetta URL 格式

ClickZetta URL 的格式如下：

```
clickzetta://username:password@instance.service/workspace?vcluster=vcluster
```

其中各部分含义如下：

* username：用户名
* password：密码
* instance：实例名称
* service：服务域名
* workspace：空间名称
* vcluster：资源名称

service 支持指定端口。如果不需要指定端口，可以直接使用域名，例如：

```
# 指定端口
clickzetta.service:9090
# 不指定端口
clickzetta.service
```

service 支持使用 http 和 https 两种协议。

### 使用 Superset 进行可视化分析

成功连接 ClickZetta 数据库后，您可以使用 Superset 进行数据可视化分析。以下是一些使用示例：

1. 创建图表：点击左侧菜单栏的 Charts，选择新建图表。在图表设置页面，选择您刚刚连接的 ClickZetta 数据库，然后选择相应的表和字段进行图表创建。
2. 创建仪表盘：点击左侧菜单栏的 Dashboards，选择新建仪表盘。在仪表盘设置页面，您可以添加多个图表，并对它们进行布局和样式调整。
3. 导出和分享：在图表或仪表盘页面，您可以点击右上角的导出按钮，将分析结果导出为图片、
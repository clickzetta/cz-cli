# Airbyte简介

Airbyte是一个开源的数据集成平台，专为从API、数据库和文件到数据库、数据仓库和数据湖的ELT（Extract, Load, Transform）管道而设计。Airbyte提供了一个简单易用的平台，帮助用户轻松实现数据同步和集成。

![Airbyte架构图](.topwrite/assets/image_1705039346358.png)

# 本地Docker安装

## Airbyte版本

对于版本v0.50.41，按照本文安装步骤进行安装，也就是采用run-ab-platform的方式。

对于Airbyte 2.0左右及以后的版本，也就是采用了abctl安装方式，请参考[airbyte安装文档](https://docs.airbyte.com/platform/using-airbyte/getting-started/oss-quickstart)进行安装，本文所提供的安装方式不适合。

## 系统要求

本指南已在以下操作系统上进行测试：macOS、Windows 10 和 Ubuntu 22.04。

## 安装步骤

1. 请确保您的电脑上已安装Docker Engine，并安装Docker Compose插件。具体安装方法请参考[官方文档](https://docs.docker.com/engine/install/)。
2. 安装完成后，通过以下命令在本地启动Airbyte：

```bash
# 从GitHub克隆Airbyte仓库
git clone --branch v0.50.41 --single-branch --depth=1 https://github.com/airbytehq/airbyte.git


# 切换到Airbyte目录
cd airbyte

# 启动Airbyte
./run-ab-platform.sh
```

3. 访问[http://localhost:8000](http://localhost:8000/)，在浏览器中打开Airbyte Web界面。
4. 系统会要求您输入用户名和密码。默认情况下，用户名为`airbyte`，密码为`password`。您可以在`.env`文件中修改这些凭据：

```
# 代理配置
# 将BASIC_AUTH_USERNAME和BASIC_AUTH_PASSWORD设置为空值，例如""，以禁用基本认证
BASIC_AUTH_USERNAME=your_new_username_here
BASIC_AUTH_PASSWORD=your_new_password_here
```

# 在Windows上部署

安装WSL 2后端和Docker后，您可以使用Windows PowerShell运行容器。此外，我们建议您在Windows上从源代码构建Airbyte，以安装`docker-compose`。以下是在Windows上安装Airbyte的推荐指南。

## 设置指南

1. 请查看[Docker文档](https://docs.docker.com/desktop/windows/install/)中的系统要求。
2. 按照系统要求的步骤操作，并确保下载并安装Linux内核更新包。
3. 在Windows上安装Docker Desktop。下载地址：[Docker Desktop](https://docs.docker.com/desktop/windows/install/)。
4. 确保在安装过程中选择以下选项：
   * 启用Hyper-V Windows功能
   * 安装WSL 2所需的Windows组件（安装后需要重启计算机）

```bash
git clone --depth=1 https://github.com/airbytehq/airbyte.git
cd airbyte
bash run-ab-platform.sh
```

5. 在浏览器中访问[http://localhost:8000](http://localhost:8000/)。
6. 系统会要求您输入用户名和密码。默认情况下，用户名为`airbyte`，密码为`password`。请在部署Airbyte到服务器后修改这些凭据。

# 在Airbyte中安装云器Lakehouse目标连接器

## 配置参考

Connector display name: Clickzetta Lakehouse

Docker repository name: clickzetta/clickzetta-airbyte

Docker image tag: 0.1.0

Connector documentation URL Optional: <https://www.yunqi.tech>

1. 在Airbyte中新建一个连接器，显示名称选择“Clickzetta Lakehouse”。
   ![新建连接器](.topwrite/assets/20240112141059_rec_.gif)
2. 配置连接器，填写必要的参数，如数据库地址、端口、用户名和密码等。
3. 创建从其他数据源到云器Lakehouse的数据同步连接，开始数据同步。
   ![创建数据同步连接](.topwrite/assets/20240112141631_rec_.gif)

# 建立连接并同步数据至云器Lakehouse

1. 新建一个连接，类型选择刚才新建的“Clickzetta Lakehouse”连接器。
   ![](.topwrite/assets/20240112141631_rec_.gif)
2. 填写连接配置信息，如数据库地址、端口、用户名和密码等。
3. 配置同步任务，选择源数据源和目标数据表，设置同步频率和过滤条件。
4. 启动同步任务，开始将数据从源数据源同步到云器Lakehouse。

![数据同步配置](.topwrite/assets/image_1705040300515.png)
![数据同步配置2](.topwrite/assets/image_1705040390515.png)

# MindsDB简介

**MindsDB 通过 AI 构建模块增强了 SQL**，以便开发人员创建需要与实时数据耦合的 AI 应用程序。MindsDB 的创新之一是能够将 AI（模型、代理、知识库）视为虚拟表，您可以使用任何AI 引擎从云器Lakehouse数据源中进行 SELECT FROM、JOIN和FINE-TUNE。

![](.topwrite/assets/image_1704978508036.png)

# 方式一：在 Docker上运行配置MindsDB

## 安装 Docker

如果您还没有安装Docker，请按照[说明](https://docs.docker.com/install)在您的计算机上安装 Docker 。要确保 Docker 已成功安装在您的计算机上，请测试Docker是否正常运行，如下所示：

```bash
docker run hello-world
```

您应该会看到`Hello from Docker!`消息。否则，请查看 [Docker 的入门](https://www.docker.com/get-started)文档。

**适用于 Mac 用户的 Docker - RAM 分配问题**

默认情况下，Docker for Mac 分配 2 GB RAM，这不足以使用 Docker 部署 MindsDB。我们建议将默认 RAM 限制增加到 8 GB。 有关如何增加分配内存的更多信息，请参阅 [Docker Desktop for Mac 用户手册。](https://docs.docker.com/desktop/mac/#resources)

## 安装并启动 MindsDB

请注意，这种 MindsDB 安装方法至少需要 8 GB RAM 和 20 GB 可用存储空间。

下载docker compose文件到本地:

<https://github.com/clickzetta/mindsdb-clickzetta/blob/staging/docker-compose-up-only.yml>

运行以下命令在 Docker 中启动 MindsDB。

```bash
docker-compose -f docker-compose-up-only.yml up -d
```

现在，您可以访问以下内容：

MindsDB Studio：

```bash
http://127.0.0.1:47334/
```

使用 MySQL 的 MindsDB

```bash
mysql -h 127.0.0.1 --port 47335 -u mindsdb -p
```

## 下一步

现在您已经在 Docker 容器中本地安装并启动了 MindsDB，接下来了解如何使用该[CREATE MODEL](https://docs.mindsdb.com/sql/create/model)语句创建和训练模型。在**MindsDB SQL**部分，您将找到 MindsDB 提供的 SQL 语法的全面概述。我们还提供了**MindsDB Mongo-QL**部分中记录的 Mongo-QL 语法。

您可以将 MindsDB 连接到不同的客户端，包括[MySQL CLI](https://docs.mindsdb.com/connect/mysql-client)。

查看[用例](https://docs.mindsdb.com/finetune/anyscale)部分，了解涵盖大型语言模型、自然语言处理、时间序列、分类和回归模型的教程。

# 方式二：通过 pip和github源代码搭建MindsDB

本节介绍如何从源代码部署MindsDB。如果您想为我们的代码做出贡献或调试 MindsDB，那么这是使用 MindsDB 的首选方式。

要成功安装 MindsDB，请使用**Python 64 位版本**。另外，请确保**Python >= 3.8**且**pip >= 20.3**。

## 安装

请注意，这种 MindsDB 安装方法需要至少 6 GB 的可用存储空间。

1. 克隆 MindsDB 存储库：

   ```bash
   git clone https://github.com/clickzetta/mindsdb-clickzetta.git
   ```

2. 创建新的虚拟环境：

   ```bash
   python -m venv mindsdb-venv
   ```

3. 激活虚拟环境：

   ```bash
   source mindsdb-venv/bin/activate
   ```

4. 安装依赖项：

   ```bash
   cd mindsdb
   pip install -e .
   pip install -r requirements/requirements-dev.txt
   ```

5. 启动MindsDB：

   ```bash
   python -m mindsdb  --config=config.json
   ```

默认情况下，MindsDB 将始终启动`http`和`mysql`API。

```bash
python -m mindsdb --api=http,mysql  --config=config.json
```

如果您想使用 Mongo API，您需要将其作为参数提供给`--api`. 您可以按如下方式进行操作：

```bash
python -m mindsdb --api=http,mongodb,mysql  --config=config.json
```

6. 现在，您可以访问以下内容：

MindsDB Studio：

```bash
http://127.0.0.1:47334/
```

使用 MySQL 的 MindsDB

```bash
mysql -h 127.0.0.1 --port 47335 -u mindsdb -p
```

## 依赖关系

默认情况下，不会安装许多数据或 ML 集成的依赖项。

如果您想要使用默认情况下不可用的依赖项的数据或 ML 集成，请通过运行以下命令进行安装：

```
pip install '.[handler_name]'
```

您可以在此处找到所有可用的[处理程序](https://github.com/clickzetta/mindsdb-clickzetta/tree/staging/mindsdb/integrations/handlers)。

## 故障排除

### Pip 和 Python 版本

目前，MindsDB 支持 Python 版本 3.8.x、3.9.x、3.10.x 和 3.11.x。

要成功安装 MindsDB，请使用**Python 64 位版本**。另外，请确保**Python >= 3.8**且**pip >= 20.3**。`pip --version`您可以通过运行和 命令来检查 pip 和 python 版本`python --version`。

请注意，根据您的环境以及安装的 pip 和 python 软件包，您可能必须使用**pip3**而不是**pip**或**python3.x** 而不是**py**。例如，`pip3 install mindsdb`代替 `pip install mindsdb`.

### 如何避免依赖性问题

**使用pip**在虚拟环境中安装 MindsDB以避免依赖问题。

### 如何避免常见错误

MindsDB 需要大约 3 GB 的可用磁盘空间来安装其所有依赖项。确保分配最小。3 GB 磁盘空间以避免 `IOError: [Errno 28] No space left on device while installing MindsDB`错误。

首先，激活安装 MindsDB 的虚拟环境。是为了避免`No module named mindsdb`错误。

如果遇到该`This site can’t be reached. 127.0.0.1 refused to connect.` 错误，请检查MindsDB服务器控制台，查看服务器是否仍处于该`starting`阶段。但如果服务器已启动，但您仍然收到此错误，请在我们的 [GitHub 存储库](https://github.com/mindsdb/mindsdb/issues)上报告该错误。

### 如何解决`ImportError: failed to find libmagic`的问题

如果出现错误，您应该通过运行以下命令之一手动`ImportError: failed to find libmagic`安装：`libmagic`

```bash
pip install python-magic-bin  # for linux and windows
brew install libmagic  # for macOS
```

# 检查云器Lakehouse Handler状态

访问[MindsDB Studio](http://127.0.0.1:47334/editor)
检查云器Lakehouse Handler状态

```SQL
select \* from information\_schema.handlers where TITLE="ClickZetta";
```

![](.topwrite/assets/image_1704968631664.png)
IMPOSRT\_SUCCESS为true，说明云器Lakehouse Handler工作正常。

# 创建一个project和云器Lakehouse数据库

```SQL
CREATE PROJECT IF NOT EXISTS clickzetta;
```

```SQL
CREATE DATABASE if not exists clickzetta\_ai\_demo --- display name for database.

WITH ENGINE = 'clickzetta', --- name of the mindsdb handler

PARAMETERS = {

"service": "region_id.api.clickzetta.com", --- ClickZetta Lakehouse service address.

"workspace": "qiliang_ws_demo", --- ClickZetta workspace.

"instance": "********", --- account instance id.

"vcluster": "default", --- vcluster

"username": "********", --- your usename.

"password": "********", --- Your password.

"schema": "ai_demo" 

};

```

检查创建结果，显示已创建：

```SQL
SHOW databases;
```

![](.topwrite/assets/image_1704968969155.png)

# 应用示例

## 预测房屋租赁价格

```SQL
--1. CONNECT ClickZetta Lakehouse
--Let's start by previewing the data we will use to train our model:
SELECT * FROM clickzetta_ai_demo.home_rentals limit 10 ;
```

![](.topwrite/assets/image_1704973236848.png)

```SQL
--2. TRAIN A MACHINE LEARNING MODEL
CREATE MODEL IF NOT EXISTS
  clickzetta.home_rentals_model
FROM clickzetta_ai_demo  (SELECT * FROM home_rentals)
PREDICT rental_price;
DESCRIBE home_rentals_model;
```

![](.topwrite/assets/image_1704973261576.png)

```SQL
--3. MAKE A PREDICTION
SELECT rental_price, 
       rental_price_explain 
FROM clickzetta.home_rentals_model
WHERE sqft = 823
AND location='good'
AND neighborhood='downtown'
AND days_on_market=10;
```

```
rental_price rental_price_explain 4464 {"predicted_value": 4464, "confidence": 0.99, "anomaly": null, "truth": null, "confidence_lower_bound": 4387, "confidence_upper_bound": 4542}
```

```SQL
--4. Bulk predictions by joining a table with your model:
SELECT t.rental_price as real_price, m.rental_price as predicted_price, t.number_of_rooms,  t.number_of_bathrooms, t.sqft, t.location, t.days_on_market 
FROM clickzetta_ai_demo.home_rentals as t 
JOIN clickzetta.home_rentals_model as m
LIMIT 100;
```

![](.topwrite/assets/image_1704973411217.png)

![](.topwrite/assets/image_1704973441296.png)

# dbt ClickZetta adapter 使用指南

## dbt 简介

dbt（Data Build Tool）是一款开源的数据建模工具，旨在将软件工程的方法引入数据建模开发过程。dbt 支持多种数据源，使得数据开发人员能够实现跨平台、质量可控的数据开发。dbt 拥有活跃的社区，提供了丰富的扩展组件，如数据质量、与其他系统集成等，让数据开发变得更加简便。

云器推出了 `dbt-clickzetta` 适配器，以支持 dbt 版本 1.5+。本文将结合 dbt 标准示例 [Jaffle Shop](https://github.com/dbt-labs/jaffle-shop-classic)，详细介绍适配器的安装和使用方法。

## 准备环境

1. 安装 dbt-clickzetta 适配器（已集成 dbt-core 和 dbt-extractor）：
   ```shell
   pip install dbt-clickzetta
   ```
2. 准备 dbt 项目：
   ```shell
   git clone https://github.com/dbt-labs/jaffle-shop-classic.git
   ```
3. 在版本控制系统中，管理和编辑项目。

## 配置

在 dbt 项目根目录（即 `jaffle_shop` 目录）编辑 `profiles.yml` 文件，如下所示：

```yaml
jaffle_shop:
  target: prod
  outputs:
    prod:
      type: clickzetta
      service: region_id.api.clickzetta.com
      instance: instance_name
      username: user_name
      password: password
      workspace: workspace_name
      schema: jaffle_shop
      vcluster: default
```

参数说明：

* 官方指定的 dbt profile 参数（如上述示例中的 jaffle\_shop、target 等），请参考 [dbt 官方文档](https://docs.getdbt.com/docs/core/connect-data-platform/connection-profiles)。
* dbt-clickzetta 插件识别的参数包括：
  * type: 固定为 clickzetta
  * service: ClickZetta Lakehouse 服务地址
  * instance: 实例名称
  * username: 用户名
  * password: 密码
  * workspace: 工作空间名称
  * schema: Schema 名称
  * vcluster: 计算集群名称

为方便使用 `dbt` 命令，可将 `profiles.yml` 文件拷贝到用户目录下：

```shell
mkdir ~/.dbt/ && cp profiles.yml ~/.dbt/
```

运行 `dbt debug` 以验证配置是否正确。

## 运行 dbt 项目

### 1. 上传数据

运行 `dbt seed`，将项目中的 CSV 数据上传到 ClickZetta Lakehouse。

### 2. 运行模型

使用 `dbt run`，dbt 将根据 models 目录中的文件描述自动生成 SQL 并执行。

### 3. 验证产出

运行 `dbt test`，对产出表进行验证。测试是您对 dbt 项目中的模型和其他资源（例如源、种子和快照）所做的断言。当您运行 `dbt test` 时，dbt 会告诉您项目中的每个测试是否通过或失败。

### 4. 生成并查看报告

运行 `dbt docs generate` 生成项目的文档网站，然后运行 `dbt docs serve` 启动本地 HTTP 服务。在浏览器中打开 `http://localhost:8080` 即可查看报告页面。

#### 查看报告

![dbt docs 截图](dbt_docs_screenshot.png)

#### 查看数据血缘

![数据血缘截图](../.topwrite/assets/image_1697458411669.png)

## 更多示例

### 示例 1：创建模型

在 `models` 目录下创建一个新文件 `example_model.sql`，并添加以下内容：

```sql
CREATE VIEW example_model AS
SELECT
  customers.first_name,
  customers.last_name,
  SUM(orders.total) AS total_spent
FROM
  {{ ref('customers') }} customers
JOIN
  {{ ref('orders') }} orders
ON
  customers.id = orders.customer_id
GROUP BY
  customers.first_name,
  customers.last_name;
```

### 示例 2：运行特定模型

运行 `dbt run-operation example_model` 来执行特定模型。

### 示例 3：使用测试

在 `models` 目录下的 `schema.yml` 文件中添加测试：

```yaml
models:
  - name: stg_customers
    columns:
      - name: customer_id
        tests:
          - unique
          - not_null
```

运行 `dbt test` 来执行测试。

### 示例 4：使用钩子（Hook）

在 `models` 目录下的 `schema.yml` 文件中添加钩子：

```yaml
models:
  - name: stg_orders
```

^

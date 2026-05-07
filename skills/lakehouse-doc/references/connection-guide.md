# CONNECTION

在Lakehouse中，CONNECTION对象扮演着至关重要的角色。它负责存储第三方服务的身份认证信息和访问管理凭据，从而实现在数据处理过程中保护敏感信息的目的。通过使用CONNECTION，用户无需将身份认证信息以明文形式暴露，从而确保数据的安全性。此外，CONNECTION还支持STS（Security Token Service）认证方式，允许跨账号授权访问Lakehouse以外的服务，进一步提高了数据访问的灵活性和安全性。

## CONNECTION的类型

根据其用途和连接的外部服务类型，CONNECTION对象主要分为以下三种类型：

1. **API Connection**：这种类型的CONNECTION主要用于存储和保护第三方应用服务的身份认证信息。通过API Connection，Lakehouse可以安全地通过API调用来与这些服务进行交互。目前，API Connection支持的外部服务包括阿里云的函数计算FC和腾讯云的云函数服务。API Connection通常与External Function结合使用，以便在Lakehouse中远程调用这些服务。
2. **Storage Connection**：Storage Connection主要用于存储第三方存储服务的身份认证信息，使得Lakehouse能够安全地访问和管理这些存储服务中的数据。目前支持的外部存储服务包括阿里云的对象存储OSS、腾讯云COS和AWS S3。
3. **Catalog Connection**：在数据湖架构中，Catalog Connection 是一种关键组件，用于将数据湖与外部的元数据存储（例如 Hive Metastore）关联起来。通过创建 Catalog Connection，用户可以实现元数据的统一管理和访问，从而直接读取存储在外部系统中的数据。Lakehouse目前只支持连接Hive。

## 创建和管理CONNECTION

为了使用CONNECTION，用户需要了解如何创建、列出、查看详情以及删除CONNECTION。以下是这些操作的基本语法和使用示例：

* **创建CONNECTION**：用户可以通过特定的创建语法来定义一个新的CONNECTION对象，其中需要指定CONNECTION的类型、名称以及相关的认证信息和参数。
  例如，创建一个API Connection的语法如下：

  ```sql
  CREATE API CONNECTION conn_aliyun_java 
    type cloud_function
    provider = 'xxx'
    region = 'xxx'
    role_arn = 'acs:ram::13843xxxxxxxxxxxxx:role/czudfrole'
    namespace = 'xxx'
    code_bucket = 'xxx';
  ```

  创建一个Storage Connection的语法如下：

  ```SQL
  CREATE STORAGE CONNECTION [IF NOT EXISTS] connection_name 
    TYPE COS
    REGION = 'xxx'
    APP_ID = 'xxx'
    ACCESS_KEY='******'
    SECRET_KEY='******';
  ```

  具体的语法和步骤可以参考[创建CONNECTION](CREATECONNECTION.md)文档。

* **列出所有的CONNECTION**：用户可以使用列出语法来查看当前Lakehouse工作空间中所有的CONNECTION对象。例如，查看当前CONNECTION的命令如下：
  ```sql
  SHOW CONNECTIONS;
  ```
  这有助于用户管理和选择已有的CONNECTION进行操作。相关的命令和选项可以在[列出所有的CONNECTION](SHOWCONNECTIONS.md)文档中找到。

* **查看CONNECTION详情**：为了更好地理解和管理CONNECTION，用户可能需要查看特定CONNECTION的详细信息。这包括认证信息、配置参数等。例如，查看一个API Connection详情的语法如下：
  ```sql
  DESCRIBE CONNECTION my_api_conn;
  ```
  查看详情的语法和方法在[查看CONNECTION详情](DESCCONNECTION.md)文档中有详细说明。

* **删除CONNECTION**：当某个CONNECTION不再需要时，用户可以通过删除语法来移除它。例如，删除一个CONNECTION的命令如下：
  ```sql
  DROP CONNECTION my_api_conn;
  ```
  这有助于保持工作空间的整洁，并防止不必要的安全风险。具体的删除步骤和注意事项在[删除CONNECTION](DROPCONNECTION.md)文档中有所描述。

^

# CONNECTION

在Lakehouse中，CONNECTION对象扮演着至关重要的角色。它负责存储第三方服务的身份认证信息和访问管理凭据，以实现数据处理过程中对敏感信息的保护。通过使用CONNECTION，用户无需将身份认证信息以明文形式暴露，从而确保数据安全。此外，CONNECTION还支持STS（Security Token Service）认证方式，允许跨账号授权访问Lakehouse外部的服务，从而进一步提高了数据访问的灵活性和安全性。

## CONNECTION的类型

根据其用途和连接的外部服务类型，CONNECTION对象主要分为以下三种类型：

1. [创建API Connection](<create-api-connection.md>)：这种类型的CONNECTION主要用于存储和保护第三方应用服务的身份认证信息。通过API Connection，Lakehouse可以安全地通过API调用与这些服务进行交互。目前，API Connection支持的外部服务包括阿里云的函数计算FC和腾讯云的云函数服务。API Connection通常与Remote Function结合使用，以便在Lakehouse中远程调用这些服务。
2. [创建Storage Connection](<create-storage-connection.md>)：Storage Connection主要用于存储第三方存储服务的身份认证信息，使得Lakehouse能够安全地访问和管理这些存储服务中的数据。目前支持的外部存储服务包括阿里云的对象存储OSS、腾讯云COS和AWS S3。
3. [创建Catalog Connection](<create-catalog-connection.md>)：在数据湖架构中，Catalog Connection是一种关键组件，用于将数据湖与外部的元数据存储（例如Hive Metastore）关联起来。通过创建 Catalog Connection，用户可以实现元数据的统一管理和访问，从而直接读取存储在外部系统中的数据。Lakehouse目前只支持连接Hive。

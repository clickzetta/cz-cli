# 数据湖存储管理：Volume

## 概述

Lakehouse Volume 是在云器 Lakehouse 中表示云对象存储位置的对象。它提供了对云上对象存储的访问、存储、管理和组织文件等功能，可用于存储和访问各种格式的文件，包括结构化、半结构化和非结构化数据。它可以与表、视图等对象一样在Lakehouse 的 Schema 下进行组织和管理。使用 Volume 功能会带来如下收益：

* 统一数据分析：支持在云器 Lakehouse 中调用 AI 负载处理对象存储中的图片、PDF 以及特殊格式的非结构化数据，与平台中的结构化数据做统一处理和分析
* 统一权限管理：支持使用云器 Lakehouse 平台的权限系统，对库表以及对象存储中的文件做统一权限管理
* 统一数据治理：对象存储中的数据会被云器 Lakehouse 平台统一管理和治理

Lakehouse Volume按照数据存储位置分为 Internal Volume 和 External Volume 两种类型：

| **特性** | **External Volume**                                                                                                                                    | **Internal Volume**                                                                                                                                                                                                                                                                                                                                   |
| :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 存储位置   | 客户指定的外部存储位置，云器仅保留路径元信息。支持的存储产品有：&#xA;- 阿里云 OSS&#xA;- 腾讯云 COS&#xA;- 亚马逊云 S3&#xA;- 谷歌云 GCS                                                               | 云器账号内部存储，与内表对象共同存储与指定Schema路径下。                                                                                                                                                                                                                                                                                                                       |
| 使用场景   | 在您已经使用对象存储服务存储和管理数据时，通过 External Volume，云器 Lakehouse 能够 Mount 到已有存储服务，将对象存储视为数据湖以共享已有数据。                                                                 | Internal Volume 默认提供了以下2种Volume对象：&#xA;- Table Volume：数据表默认关联的文件存储区域，权限与数据表权限一致。Table Volume 常用于简化批量导入、导出场景。用户只要对目标表有读写权限，即可直接通过 PUT/GET 方式向目标表默认关联的 Table Volume 目录交换文件，从而简化批量导入/导出场景下对 Volume 的权限要求。&#xA;- User Volume：用户账号关联的文件存储区域，Workspace User 默认对该区域具备管理权限。每个 Workspace 都默认拥有一个具备管理权限的 User Volume，用户可以将各种格式的文件上传至此。Table/User Volume 具备默认权限，不支持额外授权。 |
| 操作管理   | 创建 External Volume 通过 PUT 命令上传本地文件通过 GET 命令下载文件至本地查看指定 Volume 下文件列表删除指定 Volume 路径下文件使用 COPY INTO 命令导入导出数据使用SQL查询文件数据使用 get\_presigned\_url 函数获取文件访问地址。 | 通过 PUT 命令上传本地文件；删除指定 Volume 路径下文件。                                                                                                                                                                                                                                                                                                                          |
| 存储费用   | 不属于 Lakehouse 存储计费项目。                                                                                                                                  | 和内表存储相同，属于Lakehouse存储计费项目。                                                                                                                                                                                                                                                                                                                            |

## 相关链接

[内部VOLUME对象使用](internal_volume.md)

[阿里云OSS VOLUME创建](oss_volume_creation.md)

[腾讯云COS VOLUME创建](cos_volume_creation.md)

[亚马逊云S3 VOLUME创建](s3_volume_creation.md)

[查询VOLUME](structure_data_analysis.md)

[从VOLUME导入数据到表](from_volume_to_table.md)

[导出数据到VOLUME ](from_lakehouse_to_volume.md)

## 数据操作协议

| 协议类型            | 地址格式                                       | 典型场景     |
| --------------- | ------------------------------------------ | -------- |
| External Volume | volume://volume\_name/path\_to\_file       | 跨团队共享资源  |
| User Volume     | volume\:user://\~/path\_to\_file           | 用户的自有空间  |
| Table Volume    | volume\:table://table\_name/path\_to\_file | 表关联ETL文件 |

* **External Volume 格式地址** `volume://volume_name/upper.jar`

  * `volume_name` 创建的vollume名称。
  * `upper.jar` 表示目标文件名。

* **User Volume 格式地址**:`volume:user://~/upper.jar`

  * `user` 表示使用 User Volume 协议。
  * `~` 表示当前用户，为固定值。
  * `upper.jar` 表示目标文件名。

* **Table Volume 格式地址**`volume:table://table_name/upper.jar`

  * `table` 表示使用 Table Volume 协议。
  * `table_name` 表示表名，需根据实际情况填写。
  * `upper.jar` 表示目标文件名。

## DDL操作

| 命令                    | 描述                      | User Volume | Table Volume | 外部 Volume |
| --------------------- | ----------------------- | ----------- | ------------ | --------- |
| CREATE VOLUME         | 创建内部或外部 Volume。         | 否           | 否            | 是         |
| DROP VOLUME           | 移除内部或外部 Volume。         | 否           | 否            | 是         |
| DESC VOLUME           | 显示内部或外部 Volume 的属性。     | 否           | 否            | 是         |
| SHOW VOLUME DIRECTORY | 返回 Volume 中已保存文件的列表。    | 是           | 是            | 是         |
| REMOVE                | 从 Volume 中移除已保存的文件。     | 是           | 是            | 是         |
| SHOW VOLUMES          | 返回已创建的内部和外部 Volume 的列表。 | 否           | 否            | 是         |

## 权限

| 权限            | 说明                                                                             |
| ------------- | ------------------------------------------------------------------------------ |
| READ METADATA | 查看 Volume 对象元信息权限。                                                             |
| READ VOLUME   | 读取 Volume 对象下文件及目录的权限。当需要查看 Volume 下文件列表、SQL 读取 Volume 文件以及通过 GET命令下载文件时需要。    |
| WRITE VOLUME  | 写入数据到 Volume 的权限。当需要通过 PUT 命令上传文件，通过 REMOVE 命令删除文件时需要。                         |
| ALTER VOLUME  | ALTER VOLUME 命令需要的权限。如：ALTER VOLUME \<volume\_name> REFRESH 刷新Volume下的文件元数据信息。 |
| ALL           | Volume对象全部权限。                                                                  |

# 成本

* External Volume：在Lakehouse侧无额外存储费用。
* Internal Volume：按照实际存储大小收取存储费用。

## 约束与限制

* 上传单个文件大小不得超过5 GB。
* JDBC 驱动要求 1.4.4 及以上版本支持本地 PUT/GET 接口。

^

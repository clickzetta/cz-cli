# 导入本地数据

本文档详细介绍了如何将本地数据导入Lakehouse平台。目前，Lakehouse支持三种主要的本地数据导入模式：

1. 使用PUT命令上传本地文件，导入到Lakehouse中
2. **通过Lakehouse Studio页面可视化上传**：适用于小数据量的文件上传，提供用户友好的界面和简化的上传流程。
3. **使用JDBC客户端上传数据**：适合技术用户，尤其是需要批量处理小数据量文件的用户，支持快速处理CSV文件和脚本化、自动化操作。（在 JDBC 2.0.0 版本该功能已下线，推荐您使用 PUT 命令上传）


## 应用场景

* **PUT命令上传文件**：适用于源文件上传，并且需要使用 SQL 进行转换的场景。推荐在上传过程中使用 SQL 来转换或处理异常数据。支持 CSV、PARQUET、ORC 格式。
* **Lakehouse Studio页面**：适合需要上传小数据量文件的用户，支持CSV、PARQUET、AVRO、ORC、TEXT格式，但不支持压缩文件格式。建议先在本地解压缩再上传。
* **JDBC客户端**：仅支持 CSV 文件格式，不支持压缩文件，适合快速处理和自动化数据导入任务。在 JDBC 2.0.0 之后的版本中，本地 COPY 命令已被弃用。我们建议您使用 PUT 命令将数据上传到 Volume 中，然后使用服务器端的 COPY 命令进行导入。

# 使用案例

## 使用PUT命令上传数据

Lakehouse目前内置了一些[Internal Volume](internal_volume.md)可以存储文件，Internal Volume目前支持USER VOLUME和TABLE VOLUME两种对象类型。我们通过 PUT 命令将文件上传到 Internal Volume，然后使用 COPY 命令将 Volume 数据导入到表中。

**前置条件**

* 已安装[命令行工具](connect-with-cli.md)。或者，您也可以使用开源工具如 DBeaver、SQL Workbench/J 来执行该命令。
* 对目标表具有INSERT权限。

1. 在命令行中执行PUT命令将文件上传至TABLE VOLUME

```SQL
--上传文件至user volume根目录
PUT '/Users/Downloads/data.csv' TO TABLE VOLUME t_copy_from_volume FILE 'data.csv';
```

2. 使用[COPY INTO](copy-into-table.md)命令导入文件数据至目标表

```SQL
COPY INTO t_copy_from_volume FROM TABLE VOLUME t_copy_from_volume(id int, name string)  USING csv  
OPTIONS(
        'header'='true',
        'lineSep'='\n'
)
FILES ('data.csv')
--删除volume中的文件，节省存储
PURGE=TRUE;
;
```

## 使用Lakehouse Studio页面上传

## 使用限制

* **文件格式限制**：不支持复杂类型如ARRAY、MAP、STRUCT、JSON、INTERVAL。对于复杂类型数据，建议使用STRING类型映射，并通过Lakehouse SQL函数进行转化。
* **文件大小限制**：Lakehouse Studio页面和Jdbc客户端支持的单个文件最大为2GB。
* **COPY命令限制**：不支持在Studio页面上使用COPY命令上传本地文件。该命令需要指定本地文件路径，而Studio页面无法访问本地文件系统。
在数据管理中，顶部区域还提供“上传”功能，支持将本地文件上传至云器 Lakehouse 平台。

  ![](.topwrite/assets/image_1736307536920.png =640)

点击“上传”按钮，您可以轻松将数据从本地文件加载到云器 Lakehouse 平台。支持 CSV 和 TXT 两种格式，上传文件的总大小不能超过 2 GB。

![](.topwrite/assets/image_1714292021540.png =360)

**格式说明**

* **遇到错误**：当数据行中遇到异常数据等错误场景时的处理方式。

* **列分隔符**：列之间的分隔符，只允许使用单个字符。对于 CSV 文件，默认为逗号。

* **换行符**：设定换行符的处理方式，Windows 系统为 \r\n，Linux、macOS 系统为 \n。

* **忽略表头**：指是否忽略上传文件中的表头。

* **空值表示**：指定文件中空值（NULL）的表达方式。

* **集群**：需要选择集群后，才能进行数据上传。

* **数据写入方式**：

  * **追加写入**：不对历史数据做处理，直接追加写入。
  * **先清空后写入**：先清空表中的历史数据，然后写入新数据。

^

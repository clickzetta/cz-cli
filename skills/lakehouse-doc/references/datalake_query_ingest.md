# 数据湖查询

在创建 Volume 对象之后，您可以通过该对象直接查询外部存储路径中的 CSV、Parquet 和 ORC 格式的数据文件，无需依赖任何元数据系统。

## 前提条件

1. 如果数据在云厂商的对象存储中，请先完成创建 Storage Connection 和 External Volume 对象。
2. 在 Lakehouse 中查询 Volume 中的文件前，请确认是否具备对目标 Volume 对象的读权限（READ）。如果同时需要使用 [PUT 命令](PUT.md) 上传文件，则需要具备读、写权限。可以使用 `show grants to user <user_name>` 查看当前用户是否具备上述权限。

## 使用限制

* 支持的外部存储包括：阿里云 OSS、腾讯云 COS 和 AWS S3。
* 仅支持查询 CSV、Parquet 和 ORC 三种文件格式。
* 仅支持 gzip、zstd 和 zlib 三种压缩格式。

^
^
^

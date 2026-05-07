# 存储连接（Storage Connection）

Storage Connection 是云器 Lakehouse 中 Connection 对象的一种类型，属于工作空间（workspace）级别的对象，用于存储从 Lakehouse 访问云对象存储（如阿里云 OSS、腾讯云 COS、亚马逊云 S3）、其他数据平台（如 Hive）以及实时流数据（如 Kafka）中的数据时所需的身份认证和访问控制信息。它是 Lakehouse Volume 对象、External Table、External Catalog 以及 Autoloader 等对象访问外部数据的前提条件。

> 注意：如果未开通对象存储服务，同时需要通过文件方式上传数据至云器 Lakehouse，可以通过上传数据到 [内部Volume](internal_volume.md)。这种方式不需要用户开通云对象存储服务。

### 使用限制：

* 目前不支持跨云的对象存储连接。例如：开通的云器 Lakehouse 实例在阿里云上海站点，则此实例中不支持连接其他非阿里云的对象存储。
* 一个对象存储的存储连接可以用于创建多个 Volume 对象。

^

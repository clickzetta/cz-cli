# SDK更新记录

本文为您介绍Java SDK近期版本的更新说明和下载地址，基于此您可以了解Java SDK对应版本的变更点。

Java SDK近期版本的更新说明如下，详细信息请单击对应版本链接获取。下面版本SDK无法保证是最新的版本建议您直接点击[maven库](<https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java>),在库中搜索
`clickzetta-java`可以获取到最新的更新版本记录
- [下载地址一](<https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java>)
- [下载地址二](<https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions>)

| 版本                                                                                                            | 变更类型 | 描述                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Version3.0.4](<https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java/3.0.4>) | 新功能  | 实时接口支持vector类型写入                                                                                                                                                                                      |
| [Version2.0.0](<https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/2.0.0/>) | 变更  | 本地 COPY 命令已被弃用。我们建议您使用 PUT 方法将数据上传到 volume 中，然后使用服务器端的 COPY 命令进行导入。                                                                                                                                                                                      |
| [Version1.4.0](https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/1.4.3/clickzetta-java-1.4.3.jar) | 新功能  | 支持TIMESTAMP\_NTZ类型 ，支持PUT上传命令                                                                                                                                                                                        |
| [Version1.3.0](https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/1.3.0/)                          | 新功能  | 支持JSON类型                                                                                                                                                                                                   |
| [Version1.2.7](https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/1.2.7/)                          | 功能优化 | jdbc优化use schema，不存在的schema会报错                                                                                                                                                                             |
| [Version1.2.4](https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/1.2.4/)                          | 新功能  | jdbc客户端跨时区时保证和服务端时区一致，修复jdbc客户端和服务端不在一个时区显示结果不一致&#xA;                                                                                                                                                      |
|                                                                                                               | 缺陷修复 | 1. 实时写入修改commit逻辑，修复并发重连问题 修复过期stream的相关问题&#xA; 2\. 实时写入优化grpc连接存活时间，优化realtimestream和bulkloadstream接口实现&#xA; 3.jdbc修复仅有token情况下，创建连接耗时过长的问题&#xA;4.jdbc 优化服务端丢失连接时的重连逻辑&#xA;5.jdbc 修复copy from后立即查询结果失败的问题 |
| [Version1.1.4](https://repo1.maven.org/maven2/com/clickzetta/clickzetta-java/1.1.4)                           | 缺陷修复 | 1.修复jdbc内存泄漏问题&#xA; 2\. 修复实时写入SDK写入失败问题"Error details: InvalidArgumen：Passedtoken:, serverToken";&#xA;3.修复实时写入SDK兼容PK表问题                                                                                   |



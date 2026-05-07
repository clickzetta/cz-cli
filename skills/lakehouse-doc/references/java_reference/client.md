# 客户端

本文档介绍了 ClickZettaClient 的初始化和使用方法。ClickZettaClient 是用于连接 Lakehouse 的客户端，可用于创建 RowStream 和 JDBC 连接。

## ClickZettaClient初始化

ClickZettaClient支持通过JDBC URL或参数形式进行连接。以下是两种初始化方式的示例：

### 通过JDBC URL连接客户端

```java
ClickZettaClient client = ClickZettaClient.newBuilder()
    .url("jdbc:clickzetta://instanceName.service/{0}?schema={1}&username={2}&password={3}&virtualcluster={4}")
    .build();
```

### 通过参数形式连接客户端

```java
ClickZettaClient client = ClickZettaClient.newBuilder()
    .instance("instanceName")
    .service("service")
    .workspace("worksapceName")
    .username("username")
    .password("password")
    .vcluster("cluster")
    .schema("schema")
    .build();
```

| **参数**    | **是否必填** | **描述**                                                                                                                              |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| username  | Y        | 用户名                                                                                                                                 |
| password  | Y        | 密码                                                                                                                                  |
| service   | Y        | 连接lakehouse的地址, region\_id.api.clickzetta.com。可以在Lakehouse Studio管理 -> 工作空间中查看JDBC连接串![](../.topwrite/assets/image_1728887857029.png) |
| instance  | Y        | 可以在 Lakehouse Studio 管理 -> 工作空间中查看 JDBC 连接串以获取 ![](../.topwrite/assets/image_1729051500396.png)                                            |
| workspace | Y        | 使用的工作空间                                                                                                                             |
| vcluster  | Y        | 使用的虚拟集群（vcluster）                                                                                                                               |
| schema    | Y        | 访问的Schema名                                                                                                                          |

### 关闭客户端连接

在使用完客户端后，请务必显式调用 `close()` 方法以释放资源。

```java
clinet.close();
```

^

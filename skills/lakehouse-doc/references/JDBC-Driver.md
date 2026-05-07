# JDBC驱动

## Java环境需求

Clickzetta Lakehouse JDBC 驱动需要 Java 1.8 版本或更高版本。请确保您的开发环境已安装并配置了相应版本的Java。

## JDBC驱动下载

您可以通过以下两种方式下载并使用Clickzetta Lakehouse JDBC驱动：

1. 通过Maven依赖
   在项目的 `pom.xml` 文件中添加以下依赖代码：
   ```xml
   <dependency>
     <groupId>com.clickzetta</groupId>
     <artifactId>clickzetta-java</artifactId>
     <version>${version}</version>
   </dependency>
   ```
2. 直接下载 SDK Jar 包。在 Maven 仓库页面可以找到对应版本的 Jar 包并下载。

* [下载地址一](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions)
* [下载地址二](https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java)

## 配置JDBC驱动

要使用 Clickzetta Lakehouse JDBC 驱动连接到 Clickzetta Lakehouse，您需要按照以下步骤进行配置：

### JDBC驱动类

在您的 JDBC 应用程序中，使用 `com.clickzetta.client.jdbc.ClickZettaDriver` 类加载驱动。

### JDBC连接字符串

使用 JDBC 驱动连接到 Clickzetta Lakehouse 时，JDBC 连接字符串的语法格式如下：

```
jdbc:clickzetta://<instance_name>.<region_id>.api.clickzetta.com/<workspace_name>?<connection_params>
```

* 连接参数说明：

  * `<instance_name>`：Lakehouse 服务实例名称。在开通指定 Region 的 Lakehouse 服务实例时，系统会自动分配实例名称。您可以在 Clickzetta 产品控制台页面找到 Lakehouse 实例名称。

    ![](.topwrite/assets/image_1690453632319.png)

  * `<region_id>`：服务实例所在的云厂商及区域的代码，如：cn-shanghai-alicloud。所有region\_id详见[云服务和地域](Supported_Cloud_Platforms.md)。

  * `<workspace_name>`：工作空间名称。

  * `<connection_params>`：支持使用 `=` 格式定义参数，多个参数之间用 `&` 符号分隔。常用参数如下表所示：

| 参数             | 取值                                                                     |
| -------------- | ---------------------------------------------------------------------- |
| username       | Clickzetta登录用户名                                                        |
| password       | 登录用户密码                                                                 |
| schema         | 指定默认连接的schema，可选                                                       |
| virtualCluster | 配置JDBC连接默认使用的虚拟集群，可选。如不选择指定，需要连接后通过SQL命令`use vcluster <vc_name>`指定方可使用 |
| use\_http=true | 是否使用 HTTP 协议，默认为 HTTPS。当使用 Private Link 连接时需要指定该参数。                          |

#### 连接串示例

```
jdbc:clickzetta://lakehouse_instance_name.cn-shanghai-alicloud.api.clickzetta.com/default?username=Alice&password=xxxxx&schema=public&virtualCluster=default
```

^

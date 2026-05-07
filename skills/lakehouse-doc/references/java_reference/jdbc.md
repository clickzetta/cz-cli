# JDBC 使用说明

## 安装

您可以通过 Maven 依赖的方式引入 `clickzetta-java` SDK：

```xml
<dependency>
  <groupId>com.clickzetta</groupId>
  <artifactId>clickzetta-java</artifactId>
  <version>${version}</version>
</dependency>
```

直接点击maven库在库中搜索
`clickzetta-java`可以获取到最新的更新版本记录

* [下载地址一](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions)
* [下载地址二](https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java)

### JDBC连接字符串

使用JDBC驱动连接到Clickzetta Lakehouse时，JDBC连接字符串的语法格式如下：

```
jdbc:clickzetta://<instance_name>.<region_id>.api.clickzetta.com/<workspace_name>?<connection_params>
```

* 连接参数说明：

  * `<instance_name>`：Lakehouse服务实例名称。在开通指定Region的Lakehouse服务实例时，系统会自动分配实例名称。您可以在产品控制台页面找到Lakehouse实例名称。

  * `<region_id>`：服务实例所在的云厂商及区域的代码，如：cn-shanghai-alicloud。所有region\_id详见[云服务和地域](../Supported_Cloud_Platforms.md)。

  * `<workspace_name>`：工作空间名称。

  * `<connection_params>`：支持使用`=`格式定义参数，多个参数之间用`&`符号分隔。常用参数如下表所示：

| 参数                                | 取值                                                                     |
| --------------------------------- | ---------------------------------------------------------------------- |
| username                          | Clickzetta登录用户名                                                        |
| password                          | 登录用户密码                                                                 |
| schema                            | 指定默认连接的schema，可选                                                       |
| virtualCluster                    | 配置JDBC连接默认使用的虚拟集群，可选。如不选择指定，需要连接后通过SQL命令`use vcluster <vc_name>`指定方可使用 |
| use\_http=true                    | 是否使用http协议，默认是https。当使用private link连接时需要指定该参数                          |
| use\_oss\_internal\_endpoint=true | 是否使用http协议，默认是false。如果您使用的服务是阿里云支持查询时强制使用 OSS 内网 Endpoint。             |

## 驱动类名

`com.clickzetta.client.jdbc.ClickZettaDriver`

## 初始化 JDBC 连接

`clickzetta-java` 提供的 JDBC 驱动支持两种方式创建 Connection：

1. 通过 JDBC URL 创建 Connection：
   ```java
   try {
       Class.forName("com.clickzetta.client.jdbc.ClickZettaDriver");
   } catch (ClassNotFoundException e) {
       e.printStackTrace();
       System.exit(1);
   }
   Connection conn = DriverManager.getConnection("jdbc:clickzetta://instance.api.clickzetta.com/workspace?schema=schema&vcluster=cluster", username, password);
   ```

* Lakehouse url可以在Lakehouse Studio管理-》工作空间中看到jdbc连接串以查看![](../.topwrite/assets/image_1739177196184.png)

2. 通过 `ClickZettaClient` 创建 Connection：
   ```java
   ClickZettaClient client = ClickZettaClient.newBuilder()
    .instance("instanceName")
    .service("service")
    .username("username")
    .password("password")
    .vcluster("cluster")
    .schema("schema")
    .build();
   Connection conn = client.getJdbcConnection();
   ```

## 进行查询

`clickzetta-java` 提供了完整的 JDBC 标准接口，您可以使用熟悉的 JDBC API 进行数据查询。以下是一些示例：

### 示例 1：查询并打印结果

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;

public class SimpleJdbcDemo {
    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.out.println("输入参数：jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];

        Connection conn = DriverManager.getConnection(jdbcUrl, username, password);
        Statement stmt = conn.createStatement();
        ResultSet resultSet = stmt.executeQuery("SELECT * FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live LIMIT 10");
        ResultSetMetaData rsmd = resultSet.getMetaData();
        int count = rsmd.getColumnCount();
        while (resultSet.next()) {
            for (int i = 1; i <= count; i++) {
                System.out.print(rsmd.getColumnName(i) + ":" + resultSet.getObject(i) + " ");
            }
            System.out.println();
        }
        stmt.close();
        conn.close();
    }
}
```

* Lakehouse url可以在Lakehouse Studio管理-》工作空间中看到jdbc连接串以查看![](../.topwrite/assets/image_1739177196184.png)

### 示例 2：插入数据

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;

public class InsertDataDemo {
    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.out.println("输入参数：jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];

        Connection conn = DriverManager.getConnection(jdbcUrl, username, password);
    String sql = "INSERT INTO public.test_event (event_id, event_date, user_id) VALUES ('event_001', date'2025-02-10', 10001)";
    stmt.execute(sql);
    stmt.close();
    conn.close();
    }
}
```

### 示例 3：更新数据

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;

public class UpdateDataDemo {
    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.out.println("输入参数：jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];

        Connection conn = DriverManager.getConnection(jdbcUrl, username, password);
        Statement stmt = conn.createStatement();
        String sql = "UPDATE   public.test_event SET  event_date = date'2025-02-11' WHERE event_id = 'event_001'";
        stmt.execute(sql);
        stmt.close();
        conn.close();
      

    }
}
```

### 示例 4：获取作业ID，通过CZStatement获取作业ID每次只能获取最近一次的job id

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;

public class UpdateDataDemo {
    public static void main(String[] args) throws Exception {
      
        Connection conn = DriverManager.getConnection("jdbcurl", "username", "password");
        //强制转化为CZStatement获取作业ID
        CZStatement statement = (CZStatement) conn.createStatement();
        String sql1 = "select 1+2";
        statement.execute(sql1);
        System.out.println( "statement1 jobid===="+    statement.getJobId());
        String sql2 = "select 1+4";
        statement.execute(sql2);
        System.out.println( "statement2 jobid===="+    statement.getJobId());
        String sql3 = "select 1+5";
        String sql4 = "select 1+6";
        statement.execute(sql3);
        statement.execute(sql4);
//只能获取最近一次的jobid，推荐您执行完SQL就运行statement.getJobId()
        System.out.println( "statement3 jobid===="+    statement.getJobId());
        statement.close();
        conn.close();
      
    }
}
```

^

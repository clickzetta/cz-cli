# Lakehouse Java SDK 简介

Lakehouse 为您提供名为 `clickzetta-java` 的 Java SDK。通过这个统一的 SDK，您可以获得以下功能：

* 标准 Type 4 JDBC 驱动，方便您通过 JDBC 访问 ClickZetta Lakehouse
* 实时数据写入 SDK，支持您将实时数据快速写入 ClickZetta Lakehouse
* 批量数据写入 SDK，支持您将大量数据高效地写入 ClickZetta Lakehouse

## 如何获取

您可以通过 Maven 依赖的方式引入 `clickzetta-java` SDK：

```xml
<dependency>
  <groupId>com.clickzetta</groupId>
  <artifactId>clickzetta-java</artifactId>
  <version>${version}</version>
</dependency>
```

您可以直接访问 Maven 仓库，在其中搜索 `clickzetta-java` 以获取最新的版本更新记录。

* [下载地址一](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java/versions)
* [下载地址二](https://mvnrepository.com/artifact/com.clickzetta/clickzetta-java)

## 注意事项

* `clickzetta-java` 支持 Java 8 及以上版本。
* 当使用 Java 9 及以上版本时，需要添加 JVM 启动参数 `--add-opens=java.base/java.nio=ALL-UNNAMED` 以确保 SDK 正常运行。

## 常见问题及解决方案

1. 问题描述：`javax.net.ssl.SSLHandshakeException: PKIX path building failed: sun.security.provider.certpath.SunCertPathBuilderException: unable to find valid certification path to requested target`

   解决方案：您可能使用了 Java 的较早期版本（如 11.0.1+13），受 JDK 对 TLSv1.3 实现的问题（[JDK-8211806](https://bugs.openjdk.org/browse/JDK-8211806)）影响。我们推荐您升级到更新、更稳定的生产版本。如果无法升级 Java 版本，可以添加如下 Java 启动参数来规避此问题：`-Djdk.tls.client.protocols=TLSv1.2`

## 使用示例

### 1. 使用 JDBC 驱动连接 ClickZetta Lakehouse

```java
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

public class ClickZettaJDBCExample {
  public static void main(String[] args) {
    String url = "jdbc:clickzetta://your-lakehouse-url";
    String user = "your-username";
    String password = "your-password";

    try {
      Class.forName("com.clickzetta.client.jdbc.ClickZettaDriver");
      Connection connection = DriverManager.getConnection(url, user, password);
      Statement statement = connection.createStatement();
      ResultSet resultSet = statement.executeQuery("SELECT * FROM schema.your_table");

      while (resultSet.next()) {
        System.out.println( resultSet.getString(1));

      }

      resultSet.close();
      statement.close();
      connection.close();
    } catch (Exception e) {
      e.printStackTrace();
    }
  }
}
```

Lakehouse URL 可以在 Lakehouse Studio 的“管理” -> “工作空间”页面中查看 JDBC 连接字符串。![](../.topwrite/assets/image_1739177196184.png)
### 2. 使用实时数据写入 SDK 向 ClickZetta Lakehouse 发送数据

```
// 建表 create table complex_type(col1 array<string>,col2 map<int,string>, col3 struct<x:int,y:int>);
import com.clickzetta.client.BulkloadStream;
import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RowStream;
import com.clickzetta.client.StreamState;
import com.clickzetta.platform.client.api.Options;
import com.clickzetta.platform.client.api.Row;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

public class BulkloadStreamDemo {
    public static void main(String[] args) throws Exception{
        if (args.length != 5) {
            System.out.println("input arguments: jdbcUrl, username, password");
            System.exit(1);
        }
        String jdbcUrl = args[0];
        String username = args[1];
        String password = args[2];
        String schema = args[3];
        String table = args[4];

        ClickZettaClient client = ClickZettaClient.newBuilder().url(jdbcUrl).username(username).password(password).build();

        Options options = Options.builder().build();

        BulkloadStream bulkloadStream = client.newBulkloadStreamBuilder()
                .schema(schema)
                .table(table)
                .operate(RowStream.BulkLoadOperate.APPEND)
                .build();

        for (int t = 0; t < 100; t++) {
            Row row = bulkloadStream.createRow(0);
            row.setValue("col1", Arrays.asList("first", "b", "c"));
            final HashMap<Integer, String> map = new HashMap<Integer, String>();
            map.put(t,"first"+t);
            row.setValue("col2", map);
            Map<String, Object> struct = new HashMap<>();
            struct.put("x", t);
            struct.put("y", t+1);
            row.setValue("col3", struct);
            bulkloadStream.apply(row, 0);
        }
        // 必须调用 stream close 接口，触发提交动作
        bulkloadStream.close();

        // 轮训提交状态，等待提交结束
        while(bulkloadStream.getState() == StreamState.RUNNING) {
            Thread.sleep(1000);
        }
        if (bulkloadStream.getState() == StreamState.FAILED) {
            throw new RuntimeException(bulkloadStream.getErrorMessage());
        }
        client.close();
    }
}
```



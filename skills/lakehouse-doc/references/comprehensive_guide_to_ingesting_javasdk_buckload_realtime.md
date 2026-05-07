# 将数据导入云器Lakehouse的完整指南

## 数据入仓：通过JavaSDK批量和实时加载数据

#### 概述

云器Lakehouse提供了[JAVA SDK](java_reference/java-sdk-summary.md)，可在流行的IDE（如VS Code）中通过Java和SQL编程的方式，将数据加载到云器Lakehouse的表里。

#### 使用场景

这种方式可以方便地批量加载数据，适合在Java编程环境中进行大量数据的批量导入和实时写入，因为云器Lakehouse针对大批量数据写入进行了更多优化。

#### 实现步骤

##### 下载代码

从[Github仓库里](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta)下载本指南的代码到本地（如果已下载请忽略）。

将项目目录添加到VS Code的工作区中。

:-: ![](.topwrite/assets/image_1736229919125.png =512)

##### 修改参数

将 config/config-ingest-sample.json 文件名改为 config/config-ingest.json，并修改 config-ingest.json 中的各个[参数值](https://uat-doc.clickzetta.com/JDBC-Driver)。

```JSON
{
  "username": "请输入您的用户名",
  "password": "请输入您的密码",
  "service": "请输入您的服务地址，例如 region_id.api.clickzetta.com",
  "instance": "请输入您的实例 ID",
  "workspace": "请输入您的工作空间，例如 gharchive",
  "schema": "请输入您的模式，例如 public",
  "vcluster": "请输入您的虚拟集群，例如 default_ap",
  "sdk_job_timeout": 10,
  "hints": {
    "sdk.job.timeout": 3,
    "query_tag": "a_comprehensive_guide_to_ingesting_data_into_clickzetta"
  }
}
```

##### 批量加载

在VS Code中运行 BulkLoadFile.java：

:-: ![](.topwrite/assets/image_1736230356428.png =470)

```JAVA
import com.clickzetta.client.BulkloadStream;

import com.clickzetta.client.ClickZettaClient;

import com.clickzetta.client.RowStream;

import com.clickzetta.client.StreamState;

import com.clickzetta.platform.client.api.Row;

import org.json.JSONObject;


import java.io.BufferedReader;

import java.io.File;

import java.io.FileReader;

import java.sql.Connection;

import java.sql.DriverManager;

import java.sql.PreparedStatement;

import java.sql.ResultSet;

import java.sql.Statement;

import java.text.MessageFormat;

import java.nio.file.Files;

import java.nio.file.Paths;


import org.apache.log4j.PropertyConfigurator;


public class BulkloadFile {

private static ClickZettaClient client;

private static String service;

private static String instance;

private static String password;

private static String table = "lift\_tuckets\_import\_by\_java\_sdk\_bulkload";

private static String workspace;

private static String schema;

private static String vc;

private static String user;

static BulkloadStream bulkloadStream;


public static void main(String\[] args) throws Exception {

// 加载 log4j 配置文件

PropertyConfigurator.configure("config/log4j.properties");

// 读取配置文件

String content = new String(Files.readAllBytes(Paths.get("config/config-ingest.json")));

JSONObject config = new JSONObject(content);


// 从 JSON 配置文件中获取值

service = config.getString("service");

instance = config.getString("instance");

password = config.getString("password");

workspace = config.getString("workspace");

schema = config.getString("schema");

vc = config.getString("vcluster");

user = config.getString("username");


// 初始化

initialize();

// 统计文件里的行数

int fileLineCount = countFileLines("data/lift\_tickets\_data.csv");

System.out.println("Total lines in file: " + fileLineCount);

// 创建表

createTable();

// 如果目标表存在，删除表里的数据

deleteTableData();


// 插入数据

insertData();

// 检查表中数据行数

int tableRowCount = countTableRows();

System.out.println("Total rows in table: " + tableRowCount);

// 比较文件里的行数和表里的行数

if (fileLineCount == tableRowCount) {

System.out.println("Data inserted successfully! The row count matches.");

} else {

System.out.println("Data insertion failed! The row count does not match.");

}

// 关闭客户端

client.close();

}

private static void initialize() throws Exception {

String url = MessageFormat.format("jdbc\:clickzetta://{1}.{0}/{2}?" +

"schema={3}\&username={4}\&password={5}\&virtualcluster={6}&",

service, instance, workspace, schema, user, password, vc);

client = ClickZettaClient.newBuilder().url(url).build();

}
private static int countFileLines(String filePath) throws Exception {

try (BufferedReader reader = new BufferedReader(new FileReader(filePath))) {

int lines = 0;

while (reader.readLine() != null) lines++;

return lines - 1; // 减去标题行

}

}

private static void createTable() throws Exception {

String url = MessageFormat.format("jdbc\:clickzetta://{1}.{0}/{2}?" +

"schema={3}\&username={4}\&password={5}\&virtualcluster={6}&",

service, instance, workspace, schema, user, password, vc);

String createTableSQL = "CREATE TABLE if not exists " + table + " (" +

"\`txid\` string," +

"\`rfid\` string," +

"\`resort\` string," +

"\`purchase\_time\` string," +

"\`expiration\_time\` string," +

"\`days\` int," +

"\`name\` string," +

"\`address\_street\` string," +

"\`address\_city\` string," +

"\`address\_state\` string," +

"\`address\_postalcode\` string," +

"\`phone\` string," +

"\`email\` string," +

"\`emergency\_contact\_name\` string," +

"\`emergency\_contact\_phone\` string);";

try (Connection conn = DriverManager.getConnection(url, user, password);

PreparedStatement pstmt = conn.prepareStatement(createTableSQL)) {

pstmt.executeUpdate();

System.out.println("Table created successfully.");

} catch (Exception e) {

// 忽略该错误并继续

System.out.println("Ignoring exception: " + e.getMessage());

}

}

private static void deleteTableData() throws Exception {

String url = MessageFormat.format("jdbc\:clickzetta://{1}.{0}/{2}?" +

"schema={3}\&username={4}\&password={5}\&virtualcluster={6}&",

service, instance, workspace, schema, user, password, vc);

try (Connection conn = DriverManager.getConnection(url, user, password);

PreparedStatement pstmt = conn.prepareStatement("DELETE FROM " + schema + "." + table)) {

pstmt.executeUpdate();

System.out.println("Data deleted successfully from table: " + table);

}

}

private static void insertData() throws Exception {

bulkloadStream = client.newBulkloadStreamBuilder().schema(schema).table(table)

.operate(RowStream.BulkLoadOperate.APPEND)

.build();

File csvFile = new File("data/lift\_tickets\_data.csv");

BufferedReader reader = new BufferedReader(new FileReader(csvFile));

// 跳过标题行

reader.readLine(); // Skip the first line (header)


// 插入数据到数据库

String line;

while ((line = reader.readLine()) != null) {

String\[] values = line.split(",");

// 类型转换保持和服务端类型一致

String id = values\[0]; // ID 是字符串类型

String contentValue = values\[1];

Row row = bulkloadStream.createRow();

// 设置参数值

row\.setValue(0, id);

row\.setValue(1, contentValue);

// 必须调用该方法，否则无法将数据发送到服务端

bulkloadStream.apply(row);

}

// 关闭资源

reader.close();

bulkloadStream.close();

waitForBulkloadCompletion();

}

private static int countTableRows() throws Exception {

String url = MessageFormat.format("jdbc\:clickzetta://{1}.{0}/{2}?" +

"schema={3}\&username={4}\&password={5}\&virtualcluster={6}&",

service, instance, workspace, schema, user, password, vc);

try (Connection conn = DriverManager.getConnection(url, user, password);

Statement stmt = conn.createStatement()) {

String countSQL = "SELECT COUNT(\*) FROM " + schema + "." + table;

try (ResultSet rs = stmt.executeQuery(countSQL)) {

if (rs.next()) {

return rs.getInt(1);

} else {

throw new Exception("Failed to count table rows.");

}

}

}

}

private static void waitForBulkloadCompletion() throws InterruptedException {

while (bulkloadStream.getState() == StreamState.RUNNING) {

Thread.sleep(1000);

}

if (bulkloadStream.getState() == StreamState.FAILED) {

throw new ArithmeticException(bulkloadStream.getErrorMessage());

}

}

}

```

^

查看运行结果：

:-:
![](.topwrite/assets/image_1736230582408.png =474)

##### 实时加载

在VS Code中运行 StreamingInsert.java：

:-:
![](.topwrite/assets/image_1736230796054.png =477)

```JAVA
import com.clickzetta.client.ClickZettaClient;

import com.clickzetta.client.RealtimeStream;

import com.clickzetta.client.RowStream;

import com.clickzetta.platform.client.api.Options;

import com.clickzetta.platform.client.api.Row;

import com.clickzetta.platform.client.api.Stream;

import com.github.javafaker.Faker;

import org.json.JSONObject;

import org.apache.log4j.PropertyConfigurator;

import java.nio.file.Files;

import java.nio.file.Paths;

import java.sql.Connection;

import java.sql.DriverManager;

import java.sql.PreparedStatement;

import java.sql.ResultSet;

import java.sql.Statement;

import java.text.MessageFormat;

import java.util.Date;

import java.util.Random;

import java.util.UUID;

import java.io.IOException;

import java.util.Locale;

public class StreamingInsert {

private static ClickZettaClient client;

private static String service;

private static String instance;

private static String password;

private static String table = "lift\_tuckets\_import\_by\_java\_sdk\_realtime\_ingest";

private static String workspace;

private static String schema;

private static String vc;

private static String user;

static RealtimeStream realtimeStream;

public static void main(String\[] args) throws Exception {

// 加载 log4j 配置文件

PropertyConfigurator.configure("config/log4j.properties");

// 读取配置文件

String content = new String(Files.readAllBytes(Paths.get("config/config-ingest.json")));

JSONObject config = new JSONObject(content);

// 从 JSON 配置文件中获取值

service = config.getString("service");

instance = config.getString("instance");

password = config.getString("password");

workspace = config.getString("workspace");

schema = config.getString("schema");

vc = config.getString("vcluster");

user = config.getString("username");

// 初始化

String url = MessageFormat.format("jdbc\:clickzetta://{1}.{0}/{2}?" +

"schema={3}\&username={4}\&password={5}\&virtualcluster={6}&",

service, instance, workspace, schema, user, password, vc);

Options options = Options.builder().build();

client = ClickZettaClient.newBuilder().url(url).build();

// 检查并创建目标表

checkAndCreateTable(url);

realtimeStream = client.newRealtimeStreamBuilder()

.operate(RowStream.RealTimeOperate.CDC)

.options(options)

.schema(schema)

.table(table)

.build();

Faker faker = new Faker(new Locale("zh", "CN"));

String\[] resorts = {"Resort 1", "Resort 2", "Resort 3"};

Random random = new Random();

int duration = 200;

int maxRetries = 3;

// 记录开始时间

long startTime = System.currentTimeMillis();

System.out.println("Start time: " + new Date(startTime));

int totalRecords = 0;

while (duration > 0) {

for (int t = 1; t < 11; t++) {

Row row = realtimeStream.createRow(Stream.Operator.UPSERT);

row\.setValue("txid", UUID.randomUUID().toString());

row\.setValue("rfid", Long.toHexString(random.nextLong() & ((1L << 96) - 1)));

row\.setValue("resort", faker.options().option(resorts));

row\.setValue("purchase\_time", new Date().toString());

row\.setValue("expiration\_time", new Date(System.currentTimeMillis() + 86400000L).toString());

row\.setValue("days", faker.number().numberBetween(1, 7));

row\.setValue("name", faker.name().fullName());

row\.setValue("address\_street", faker.address().streetAddress());

row\.setValue("address\_city", faker.address().city());

row\.setValue("address\_state", faker.address().state());

row\.setValue("address\_postalcode", faker.address().zipCode());

row\.setValue("phone", faker.phoneNumber().phoneNumber());

row\.setValue("email", faker.internet().emailAddress());

row\.setValue("emergency\_contact\_name", faker.name().fullName());

row\.setValue("emergency\_contact\_phone", faker.phoneNumber().phoneNumber());

int attempts = 0;

boolean success = false;

while (attempts < maxRetries && !success) {

try {

realtimeStream.apply(row);

success = true;

} catch (IOException e) {

attempts++;

System.err.println("Attempt " + attempts + " failed: " + e.getMessage());

if (attempts == maxRetries) {

throw e;

}

Thread.sleep(1000); // 等待 1 秒后重试

}

}

totalRecords++;

}

Thread.sleep(200);

duration = duration - 1;

}

realtimeStream.close();

client.close();

// 记录结束时间

long endTime = System.currentTimeMillis();

System.out.println("End time: " + new Date(endTime));

// 计算平均每秒插入的记录数

double elapsedTimeInSeconds = (endTime - startTime) / 1000.0;

double recordsPerSecond = totalRecords / elapsedTimeInSeconds;

System.out.println("Total records inserted: " + totalRecords);

System.out.println("Elapsed time (seconds): " + elapsedTimeInSeconds);

System.out.println("Average records per second: " + recordsPerSecond);

}

private static void checkAndCreateTable(String url) throws Exception {

String checkTableSQL = "SELECT 1 FROM " + schema + "." + table + " LIMIT 1";

String createTableSQL = "CREATE TABLE if not exists " + table + " (" +

"\`txid\` string PRIMARY KEY," +

"\`rfid\` string," +

"\`resort\` string," +

"\`purchase\_time\` string," +

"\`expiration\_time\` string," +

"\`days\` int," +

"\`name\` string," +

"\`address\_street\` string," +

"\`address\_city\` string," +

"\`address\_state\` string," +

"\`address\_postalcode\` string," +

"\`phone\` string," +

"\`email\` string," +

"\`emergency\_contact\_name\` string," +

"\`emergency\_contact\_phone\` string);";

try (Connection conn = DriverManager.getConnection(url, user, password);

Statement stmt = conn.createStatement()) {

try (ResultSet rs = stmt.executeQuery(checkTableSQL)) {

// 如果表存在，什么也不做

} catch (Exception e) {

// 如果表不存在，创建表

try (PreparedStatement pstmt = conn.prepareStatement(createTableSQL)) {

pstmt.executeUpdate();

System.out.println("Table created successfully.");

}

}

}

}

}

```

查看运行结果：

:-:
![](.topwrite/assets/image_1736231074532.png =478)

#### 下一步建议

通过 Studio 数据管理查看导入的数据。
对导入的数据进行清洗和转换。
通过 Data GPT 探索和分析导入的数据。

#### 资料

[Java SDK](java_reference/java-sdk-summary.md)简介

[批量写入数据](java_reference/bulkload-upload.md)

[实时写入数据](java_reference/realtime-upload.md)

[多表实时同步](realtime_sync.md)

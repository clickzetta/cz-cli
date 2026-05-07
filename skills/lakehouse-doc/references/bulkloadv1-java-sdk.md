# 使用 Python 批量上传数据（BulkLoadV1）
>原有BulkLoadV1接口会停止维护,陆续下线请您尽快迁移到[BulkloadV2接口](<bulkloadv2-java-sdk.md>)，clickzetta-java版本需要3.0.21 或更高版本。BulkloadV2接口上线:全新V2接口发布,支持更高效的数据处理能力和更稳定的服务保障。V2新版本收益:
i.性能提升30%:显著提升数据集成同步任务及自定义批量与寻入任务的效率。
ii.流程优化:引入基于Table Volume的数据暂存和加载机制,增强任务的可审计性和数据追溯能力,让您的数据管理更加规范和安全。
## MAVEN依赖
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


## 创建 BulkloadStream

要通过 ClickZetta 客户端创建一个批量写入流，请参考以下示例代码：

```java
RowStream stream = client.newBulkloadStreamBuilder()
        .schema(schema)
        .table(TABLE_NAME)
        .operate(RowStream.BulkLoadOperate.APPEND)
        .build();
```

### Options

在clickzetta-java版本3.0.18以后提供了options。options用于指定上传选项入指定分取

```
bulkloadStream=client.newBulkloadStreamBuilder().schema(schema).table(table)
                .options(BulkLoadOptions.newBuilder().withPartitionSpecs(Optional.of("your_partition_spec")).build())

                .operate(RowStream.BulkLoadOperate.APPEND)
                .build();
```

* withPartitionSpecs 用于指定目标表的分区信息，控制数据写入的分区行为。

  * 非分区表：忽略此参数或设置为
  * 分区表：
    * 静态分区写入，需要将所有数据写入指定的固定分区，无论源数据中分区列的实际值是什么，写入目标表时都会使用 `partition_spec` 指定的分区值，所有数据都会写入到同一个指定分区中。参数格式是'分区列1=值1,分区列2=值2'
      - 动态分区写入，根据数据中分区列的实际值，自动写入到对应分区。忽略此参数，系统根据数据中分区列的值自动创建或写入相应分区

### 操作类型

在创建 Bulkload 时，可以通过 `operate` 方法指定以下操作类型：

* `RowStream.BulkLoadOperate.APPEND`：追加模式，向表中添加数据。
  ```
  bulkloadStream=client.newBulkloadStreamBuilder().schema(schema).table(table)
          .operate(RowStream.BulkLoadOperate.APPEND)
          .build();
  ```

* `RowStream.BulkLoadOperate.OVERWRITE`：覆盖模式，删除表中现有数据后再写入新数据。
  ```
  bulkloadStream=client.newBulkloadStreamBuilder().schema(schema).table(table)
          .operate(RowStream.BulkLoadOperate.OVERWRITE)
          .build();
  ```

## 写入数据

使用 Row 对象表示要写入的具体数据。通过调用 `row.setValue` 方法将数据封装到 Row 对象中。

```java
Row row = stream.createRow(0);
row.setValue("id", t);
row.setValue("name", String.valueOf(t));
stream.apply(row, 0);
```

* `createRow` 方法创建 Row 对象时，需要传入一个整数作为分片 ID。这个 ID 可以配合多线程/进程技术，用多个互补相同的分片 ID 来写入数据，从而有效提升写入数据的速度。
* `setValue` 方法的第一个参数为字段名，第二个参数为具体的数据。要求数据类型与表类型一致。
* `apply` 方法用于写入数据，需要指定 Row 对象以及相应的分片 ID。

### 写入复杂类型数据

```java
// 写入数组
row.setValue("col1", Arrays.asList("first", "b", "c"));

// 写入映射
final HashMap<Integer, String> map = new HashMap<Integer, String>();
map.put(t, "first" + t);
row.setValue("col2", map);

// 写入结构体
Map<String, Object> struct = new HashMap<>();
struct.put("first", "first-" + i);
struct.put("second", i);
row.setValue("col3", struct);
```

## 提交数据

批量写入的数据只有在提交之后才可见。因此，提交过程非常重要。

```java
bulkloadStream.close();
```

* 通过 `bulkloadStream.getState()` 获取 BulkloadStream 的状态。
* 如果提交失败，可以通过 `bulkloadStream.getErrorMessage()` 获取错误信息。

## 使用示例

以下是一个使用 Bulkload 写入复杂类型数据的示例：

```java
// 建表 create table complex_type(col1 array<string>,col2 map<int,string>, col3 struct<x:int,y:int>);
import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RowStream;
import com.clickzetta.platform.client.api.Options;
import com.clickzetta.platform.client.api.Row;
import com.clickzetta.platform.client.api.Stream;

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

* Lakehouse url可以在Lakehouse Studio管理-》工作空间中看到jdbc连接串以查看![](../.topwrite/assets/image_1739177196184.png)



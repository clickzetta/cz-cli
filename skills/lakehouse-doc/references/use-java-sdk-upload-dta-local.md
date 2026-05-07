# 使用Java SDK批量上传数据

本文档主要介绍如何使用 Java SDK 的 BulkloadStream 批量将数据加载到 Lakehouse 中。它适合一次性大量数据导入，支持自定义数据源，提供了数据导入的灵活性。本次案例以读取本地文件为例。如果您的数据源在对象存储或 Lakehouse Studio 数据集成支持的范围内，推荐使用 COPY 命令或数据集成功能。

# 参考文档

[Java SDK批量上传数据](java_reference/bulkload-upload.md)

## 应用场景

* 适用于需要批量上传大量数据的业务场景。
* 适合熟悉Java并需要自定义数据导入逻辑的开发人员。

## 使用限制

* BulkloadStream不支持主键（pk）表的写入。
* 不适用于时间间隔小于五分钟的频繁数据上传场景。

# 使用案例

本案例以读取本地 CSV 文件为例，使用的数据集是 [巴西电子商务](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce?select=olist_order_items_dataset.csv) 公共数据集中的 olist_order_items_dataset 数据。若数据源位于对象存储或 Lakehouse Studio 数据集成功能支持的范围，推荐使用 COPY 命令或数据集成功能。

## 前置条件

* 创建表
  * ```SQL
    create    table bulk_order_items (
              order_id STRING,
              order_item_id INT,
              product_id STRING,
              seller_id STRING,
              shipping_limit_date STRING,
              price DOUBLE,
              freight_value DOUBLE
              );
    ```

* 对目标表具有INSERT权限。

## 使用Java代码开发

### Maven依赖

在项目的 `pom.xml` 文件中添加 Lakehouse 的 Maven 依赖。Lakehouse Maven 依赖的最新版本可以在 [maven库](https://central.sonatype.com/artifact/com.clickzetta/clickzetta-java) 中找到。

```SQL
<dependency>
    <groupId>com.clickzetta</groupId>
    <artifactId>clickzetta-java</artifactId>
    <version>1.3.1</version>
</dependency>
```

### 编写Java代码

1.  **初始化 Lakehouse 客户端和 BulkloadStream**：创建 `BulkloadFile` 类，初始化 Lakehouse 连接和 BulkloadStream 对象。
2.  **读取本地 CSV 文件并写入 Lakehouse**：使用 Java IO 流读取本地 CSV 文件，并将数据逐行写入 Lakehouse。

```SQL

import com.clickzetta.client.BulkloadStream;
import com.clickzetta.client.ClickZettaClient;
import com.clickzetta.client.RowStream;
import com.clickzetta.client.StreamState;
import com.clickzetta.platform.client.api.Row;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.text.MessageFormat;

public class BulkloadFile {
    private static ClickZettaClient client;
    private static final String password = "";
    private static final String table = "bulk_order_items";
    private static final String workspace = "";
    private static final String schema = "public";
    private static final String vc = "default";
    private static final String user = "";
    static BulkloadStream bulkloadStream;
    public static void main(String[] args) throws Exception {
        initialize();
        File csvFile = new File("olist_order_items_dataset.csv");
        BufferedReader reader = new BufferedReader(new FileReader(csvFile));
        // Skip the header row
        reader.readLine(); // Skip the first line (header)
        // Insert data into the database
        String line;

        while ((line = reader.readLine()) != null) {
            String[] values = line.split(",");
            //类型转化保持和服务端类型一致
            String orderId = values[0];
            int orderItemId = Integer.parseInt(values[1]); // Convert order_item_id to int
            String productId = values[2];
            String sellerId = values[3];
            String shippingLimitDate = values[4];
            double price = Double.parseDouble(values[5]);
            double freightValue = Double.parseDouble(values[6]);
            Row row = bulkloadStream.createRow();
            // Set parameter values
            row.setValue(0, orderId);
            row.setValue(1, orderItemId);
            row.setValue(2, productId);
            row.setValue(3, sellerId);
            row.setValue(4, shippingLimitDate);
            row.setValue(5, price);
            row.setValue(6, freightValue);
         //必须调用该方法，否则无法将数据发送到服务端
            bulkloadStream.apply(row);
        }
        // Close resources
        reader.close();
        bulkloadStream.close();
        waitForBulkloadCompletion();
        client.close();
        System.out.println("Data inserted successfully!");
    }
    private static void initialize() throws Exception {
        String url = MessageFormat.format("jdbc:clickzetta://demo_instance.cn-shanghai-alicloud.api.clickzetta.com/{0}?" +
                        "schema={1}&username={2}&password={3}&virtualcluster={4}&",
                workspace, schema, user, password, vc);
        client = ClickZettaClient.newBuilder().url(url).build();
        bulkloadStream = client.newBulkloadStreamBuilder().schema(schema).table(table)
                .operate(RowStream.BulkLoadOperate.APPEND)
                .build();
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

# 使用Python SDK批量上传数据

本文档详细介绍了如何使用Python SDK中的BulkloadStream将数据批量加载到Lakehouse中。这种方法适合一次性大量数据的导入，支持自定义数据源，为数据导入提供了灵活性。本案例以读取本地CSV文件为例，如果数据源位于对象存储或Lakehouse Studio支持的数据集成范围内，推荐使用COPY命令或数据集成功能。

# 参考文档

[Python SDK上传数据](python_reference/bulkload-upload.md)

## 应用场景

* 适用于需要批量上传数据的业务场景。
* 适合熟悉Python并需要自定义数据导入逻辑的开发人员。

## 使用限制

* BulkloadStream不支持主键（pk）表的写入。
* 不适用于时间间隔小于五分钟的频繁数据上传场景。

# 使用案例

本案例使用[巴西电子商务](https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce?select=olist_order_items_dataset.csv)公共数据集中的`olist_order_payments_dataset`数据集。

## 前置条件

* 创建目标表`bulk_order_payments`：

```SQL

CREATE TABLE bulk_order_payments (
          order_id STRING,
          payment_sequence INT,
          payment_type STRING,
          payment_installments INT,
          payment_value DOUBLE
          );
```

* 对目标表具有INSERT权限。

| **参数**    | **是否必填** | **描述**                                                                                                                              |
| --------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| username  | Y        | 用户名                                                                                                                                 |
| password  | Y        | 密码                                                                                                                                  |
| service   | Y        | 连接lakehouse的地址, region\_id.api.clickzetta.com。可以在Lakehouse Studio管理-》工作空间中看到jdbc连接串![](../.topwrite/assets/image_1728887857029.png) |
| instance  | Y        | 可以在Lakehouse Studio管理->工作空间中查看JDBC连接串以获取![](../.topwrite/assets/image_1729051500396.png)                                            |
| workspace | Y        | 使用的工作空间                                                                                                                             |
| vcluster  | Y        | 使用的vc                                                                                                                               |
| schema    | Y        | 访问的schema名                                                                                                                          |

## 使用Python代码开发

使用pip安装Lakehouse依赖的Python包，Python版本要求3.6及以上：

```SQL
pip install clickzetta-connector
```

### 编写Python代码

```SQL
from clickzetta import connect
import csv

def get_lakehouse_connect():
    conn = connect(
        username='',
        password='',
        service='api.clickzetta.com',
        instance='',
        workspace='',
        schema='public',
        vcluster='default_ap')
    return conn

conn = get_lakehouse_connect()
bulkload_stream = conn.create_bulkload_stream(schema='public', table='bulk_order_payments')
writer = bulkload_stream.open_writer(0)

with open('olist_order_payments_dataset.csv', 'r') as csvfile:
    reader = csv.reader(csvfile)
    # Skip header row
    next(reader)
    # 上传数据
    for record in reader:
        # 使用bulkload创建row上传
        bulkloadrow = writer.create_row()
        bulkloadrow.set_value('order_id', record[0])
        bulkloadrow.set_value('payment_sequence', int(record[1]))
        bulkloadrow.set_value('payment_type', record[2])
        bulkloadrow.set_value('payment_installments', int(record[3]))
        bulkloadrow.set_value('payment_value', float(record[4]))
        # 必须调用，否则无法发送到服务端数据
        writer.write(bulkloadrow)
writer.close()
# 提交数据导入完成
bulkload_stream.commit()
```

^

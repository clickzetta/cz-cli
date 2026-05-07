# 使用 Python 批量上传数据（BulkLoadV1）



Clickzetta Lakehouse 通过 `clickzetta-connector` 包提供了使用 Python 语言进行批量数据上传（Bulkload）的 API。该 API 使得数据可以直接从客户端发送到存储系统，传输过程不消耗计算资源，数据在显式 commit 后可见（commit 过程会消耗少量计算资源）。适用于高吞吐、对数据新鲜度（data freshness）要求相对宽松的场景。

通过 Bulkload 相关 API，可以实现单线程数据上传。

安装

如果安装过旧版本的 SDK，先卸载避免冲突：

```shell
pip uninstall clickzetta-connector clickzetta-connector-python clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 -y
```

> 卸载前请记录好旧版本的包，以防需要回退。查看已安装包版本命令：

```shell
pip show clickzetta-connector clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 clickzetta-connector-python
```

安装最新版本（要求 Python >=3.7）：

```bash
pip install clickzetta-connector -U -i https://pypi.org/simple/
```


## 批量导入原理

批量上传的 SDK 提供了一种高效的数据导入机制，适用于 Clickzetta Lakehouse。以下是其工作原理的简化描述和流程图：

1. **数据上传**：通过SDK，您的数据首先被上传到对象存储服务。这一步骤的性能受到本地网络速度和并发连接数的影响。
2. **触发导入**：数据上传完成后，当您调用`bulkloadStream.commit()`方法时，SDK会自动触发一个SQL命令，将数据从对象存储导入到Lakehouse的表中。不建议您在一个任务中频繁调用`bulkloadStream.commit()`，该方法最终只能调用一次。
3. **计算资源**：上传数据建议选择[通用型计算集群](../create_cluster.md)（GENERAL PURPOSE VIRTUAL CLUSTER）通用型计算资源，它更适合运行批量作业和加载数据作业。数据从对象存储到 Lakehouse 表的导入速度取决于您配置的计算资源的大小。
4. **分片上传优化**：处理大于1GB的压缩数据时，建议在`createRow`方法中为每个并发线程或进程分配唯一的分片ID。这种做法能够充分发挥多线程或多进程的并行处理优势，显著提升数据导入效率。最佳实践是根据并发的数量来确定分片 ID 的数量，确保每个并发对应一个独立的分片 ID。如果多个并发被分配了相同的分片 ID，最终写入的数据可能会发生覆盖，导致先前写入的数据丢失。为确保所有分片的数据都被正确导入表中，请在所有并发操作完成后，调用`bulkloadStream.commit()`方法来提交整个导入任务。

以下是批量导入原理的流程图：

```
[SDK上传数据] ──> [对象存储] ──> [调用bulkloadStream.close()]
                                ↓
                         [触发SQL命令] ──> [Lakehouse表]
```

## 单线程写入

假设上传数据的目标表为 `public.bulkload_test`，DDL 如下：

```sql
CREATE TABLE public.bulkload_test (
    i BIGINT,
    s STRING,
    d DOUBLE
);
```

单线程模式的完整样例代码：

```python
from clickzetta import connect

conn = connect(
    username='your_username',
    password='your_password',
    service='<region\_id>.api.clickzetta.com',
    instance='your_instance',
    workspace='your_workspace',
    schema='public',
    vcluster='default'
)

bulkload_stream = conn.create_bulkload_stream(schema='public', table='bulkload_test')

writer = bulkload_stream.open_writer(0)
for index in range(1000000):
    row = writer.create_row()
    row.set_value('i', index)
    row.set_value('s', 'Hello')
    row.set_value('d', 123.456)
    writer.write(row)
writer.close()

bulkload_stream.commit()
```

## API 分步详解

1. 创建 `connection` 对象，根据您的实际情况替换参数即可：
   ```python
   conn = connect(
       username='your_username',
       password='your_password',
       service='<region\_id>.api.clickzetta.com',
       instance='your_instance',
       workspace='your_workspace',
       schema='public',
       vcluster='default'
   )
   ```

| **参数**    | **是否必填** | **描述**                                                                                                                          |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| username  | Y        | 用户名                                                                                                                             |
| password  | Y        | 密码                                                                                                                              |
| service   | Y        | 连接 Lakehouse 的地址，例如 <region\_id>.api.clickzetta.com。可以在 Lakehouse Studio 管理 -> 工作空间中看到 JDBC 连接串![](../.topwrite/assets/image_1728887857029.png) |
| instance  | Y        | 可以在 Lakehouse Studio 管理 -> 工作空间中查看 JDBC 连接串以获取![](../.topwrite/assets/image_1729051500396.png)                                        |
| workspace | Y        | 使用的工作空间                                                                                                                         |
| vcluster  | Y        | 使用的 VC                                                                                                                           |
| schema    | Y        | 访问的 Schema 名                                                                                                                      |

2. 创建 `BulkLoad Stream` 对象，指定上传的目标表、上传方式等：
   **必选参数**
   * `table`：表名称
   **可选参数**
   * `schema`：如未指定，则使用 `connection` 对象中指定的 `schema`
    * `operation`
        * `BulkLoadOperation.APPEND`：增量模式（写入的数据都作为新数据，不对已有数据有任何影响）
        * `BulkLoadOperation.OVERWRITE`：覆盖模式（清空已有表数据，将新数据写入表中）

* `partition_spec`：用于指定目标表的分区信息，控制数据写入的分区行为。
    * 非分区表：忽略此参数或设置为空。
    * 分区表：
        * 静态分区写入：需要将所有数据写入指定的固定分区。无论源数据中分区列的实际值是什么，写入目标表时都会使用 `partition_spec` 指定的分区值，所有数据都会写入到同一个指定分区中。参数格式为 '分区列1=值1,分区列2=值2'。
        * 动态分区写入：根据数据中分区列的实际值，自动写入到对应分区。忽略此参数，系统根据数据中分区列的值自动创建或写入相应分区。

  ```python

  from clickzetta.bulkload.bulkload_enums import BulkLoadOperation

  # APPEND 模式构建，默认 operation 即为 APPEND
  bulkload_stream = conn.create_bulkload_stream(schema='public', table='bulkload_append_test')



  # OVERWRITE 模式构建
  bulkload_stream = conn.create_bulkload_stream(
      schema='public',
      table='bulkload_overwrite_test',
      partition_spec='pt=2023-07-01',
      operation=BulkLoadOperation.OVERWRITE
  )
  ```

3. 创建 `writer` 并写入数据：
   每个 `bulkload stream` 可以创建多个 `writer`，不同的 `writer` 需要用不同的 id 标识。使用多个 `writer` 可以实现在一次 commit 中多线程并发写入的场景。
   ```python
   # 利用 `open_writer` 方法创建 `writer`，参数为 `writer` id。单机模式下，只有一个 `writer` id 即可，直接传入 0.
   writer = bulkload_stream.open_writer(0)
   ```
4. 写入数据：
   ```python
   # 每一行数据都需要用 create_row() 方法创建 Row 对象，然后用 set_value() 方法写入具体数据。
   # set_value() 第一个参数为列名，第二个参数为值
   row = writer.create_row()
   row.set_value('i', 1)
   row.set_value('s', 'January')
   row.set_value('d', 123.456)
   writer.write(row)
   ```
   通过 writer 写入的数据将直接在存储系统中形成相应的 parquet 文件。writer 将根据写入的数据量自动进行文件切割。当 writer 写入数据结束后，需要显式调用 writer.close() 来保证数据完整性。
   ```python
   writer.close()
   ```
5. 提交 stream。commit 前需要确保各 writer 均已完成写入并关闭。commit 成功后数据在表中可见。
   ```python
   bulkload_stream.commit()
   ```
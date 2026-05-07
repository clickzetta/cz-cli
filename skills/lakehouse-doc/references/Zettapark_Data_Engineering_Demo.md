# 基于 Lakehouse Zettapark 进行数据工程 Data Engineering

这是一个非常基础的数据工程示例，演示了如何通过云器 Zettapark Python 代码进行读取、分组和写入数据等基本 DataFrame 操作。本示例使用云器Lakehouse内置的免费示例数据库（clickzetta\_sample\_data.tpch\_100g）作为数据源。

步骤如下：

```
1，通过Zettapark连接到云器Lakehouse

2，通过SupplierKey连接 2个大型表 (LINEITEMS 有 6亿行 & SUPPLIER 有 100 万行)

3，通过将虚拟计算集群调整到不同规格来演示按需扩展

4，对比不同规格的虚拟计算集群对同一个任务的执行时间的不同

    汇总供应商和零件编号的数据以计算总和、最小值和最大值（3500万行）

    将结果数据框写入云器Lakehouse物理表（8000万行）
```

也可以通过[下载Jupyter Notebook文件](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/Zettapark_Data_Engineering_Demo.ipynb)直接运行本实例。

**整个操作从调整计算资源、读取数据、连接、汇总大约需要 30 来秒，向您展示了云器 Lakehouse 强大的功能、即时可扩展性和性能。**

## 安装云器 Zettapark

```python
# !pip install clickzetta-zettapark-python
```

## 通过 Zettapark 连接到云器 Lakehouse (Without PySpark)

```python
import time
from clickzetta.zettapark.session import Session
import clickzetta.zettapark.functions as f
from clickzetta.zettapark import Session, DataFrame
from clickzetta.zettapark.functions import udf, col
from clickzetta.zettapark.types import IntegerType
from clickzetta.zettapark.functions import call_udf
```

<----- Make these changes before running the notebook --------------------
Change Connection params to match your environment
<----------------------------------------------------------------------------

VCLUSTER\_Name = 'default\_ap'
VCLUSTER\_Size = "XSMALL"
VCLUSTER\_ReSize = "MEDIUM"
Workspace\_Name = 'gharchive'
Schema\_Name = 'Public'

```python
import json
from clickzetta.zettapark.session import Session
# 1- 创建会话连接云器Lakehouse
# 从配置文件中读取参数
with open('config.json', 'r') as config_file:
config = json.load(config_file)

print("正在连接到云器Lakehouse.....n")


# 创建会话
session = Session.builder.configs(config).create()

print("连接成功！...n")


```

正在连接到云器Lakehouse.....
连接成功！...

```python
sql_cmd = f"CREATE VCLUSTER IF NOT EXISTS {VCLUSTER_Name} VCLUSTER_SIZE = {VCLUSTER_Size} AUTO_SUSPEND_IN_SECOND = 10 "
print("XSMALL VCLUSTER 创建就绪 n")

session.sql(sql_cmd).collect()

session.use_schema(Schema_Name)
```

XSMALL VCLUSTER 创建就绪

> 注：计算集群的vcluster\_size参数同时支持以T-shirt size（XSMALL、SMALL、Large等）和以数字（1,2,4,16等）表达的方式，以提供更丰富的计算集群规格，满足不同场景的需要。更多信息详见：[计算集群规格代码变更说明](vcluster_size_description.md)

`config.json` 文件样本([参数说明](https://doc.clickzetta.com/JDBC-Driver))：

```json
{

  "username": "请替换为您的用户名",

  "password": "请替换为您的密码",

  "service": "请替换为您的服务地址",

  "instance": "请替换为您的实例ID",

  "workspace": "请替换为您的工作空间",

  "schema": "请替换为您的模式",

  "vcluster": "请替换为您的虚拟集群",

  "sdk_job_timeout": 60,

  "hints": {

    "sdk.job.timeout": 60,

    "query_tag": "test_conn_hints_zettapark"

  }

}
```

## 开始数据工程 Data Engineering Process

```python
from clickzetta.zettapark.functions import col, sum, min, max

print("Joining, Aggregating with 2 large tables(600M & 1M rows) & Writing results to new table(80M rows) ..n")

# 2- define table
dfLineItems = session.table("clickzetta_sample_data.tpch_100g.LINEITEM") # 600 Million Rows
dfSuppliers = session.table("clickzetta_sample_data.tpch_100g.SUPPLIER") # 100K Rows

print('Lineitems Table: %s 行' % dfLineItems.count())
print('Suppliers Table: %s 行' % dfSuppliers.count())

# 3 - JOIN TABLES
dfJoinTables = dfLineItems.join(dfSuppliers, dfLineItems["L_SUPPKEY"] == dfSuppliers["S_SUPPKEY"])

# 4 - SUMMARIZE THE DATA BY SUPPLIER, PART, SUM, MIN & MAX
dfSummary = dfJoinTables.groupBy("S_NAME", "L_PARTKEY").agg(
sum(col("L_QUANTITY")).alias("TOTAL_QTY"),
min(col("L_QUANTITY")).alias("MIN_QTY"),
max(col("L_QUANTITY")).alias("MAX_QTY")
)

dfSummary.show()

```

```
Joining, Aggregating with 2 large tables(600M & 1M rows) & Writing results to new table(80M rows) ..
Lineitems Table: 600037902 行
Suppliers Table: 1000000 行
------------------------------------------------------------------
|         s_name         |   l_partkey    | total_qty | min_qty | max_qty |
------------------------------------------------------------------
| Supplier#000102785     |  18602748      |   156.00  |  12.00  |  49.00  |
| Supplier#000268783     |   8268782      |   228.00  |   1.00  |  44.00  |
| Supplier#000680518     |  12680517      |   107.00  |   8.00  |  47.00  |
| Supplier#000981141     |   1731139      |   228.00  |   5.00  |  48.00  |
| Supplier#000172390     |   1172389      |   192.00  |   1.00  |  38.00  |
| Supplier#000763964     |   1763963      |   174.00  |   1.00  |  47.00  |
| Supplier#000087125     |  16337076      |   168.00  |   4.00  |  50.00  |
| Supplier#000092530     |   1842528      |   169.00  |   1.00  |  48.00  |
| Supplier#000366762     |  18866725      |   156.00  |   3.00  |  41.00  |
| Supplier#000785842     |   4285833      |   238.00  |   2.00  |  40.00  |
------------------------------------------------------------------
```

```python
# 2 - READ & JOIN 2 LARGE TABLES (600M & 1M rows)
from clickzetta.zettapark.functions import col, sum, min, max

print("正在合并和聚合两个大表（6亿行和100万行），并将结果写入新表（8000万行）..n")

dfLineItems = session.table("clickzetta_sample_data.tpch_100g.LINEITEM") # 600 Million Rows
dfSuppliers = session.table("clickzetta_sample_data.tpch_100g.SUPPLIER") # 1 Million Rows

print('Lineitems Table: %s 行' % dfLineItems.count())
print('Suppliers Table: %s 行' % dfSuppliers.count())

# 3 - JOIN TABLES
dfJoinTables = dfLineItems.join(dfSuppliers, dfLineItems["L_SUPPKEY"] == dfSuppliers["S_SUPPKEY"])

# 4 - SUMMARIZE THE DATA BY SUPPLIER, PART, SUM, MIN & MAX
dfSummary = dfJoinTables.groupBy("S_NAME", "L_PARTKEY").agg(
sum("L_QUANTITY").alias("TOTAL_QTY"),
min("L_QUANTITY").alias("MIN_QTY"),
max("L_QUANTITY").alias("MAX_QTY")
)

dfSummary.show()
```

```
正在合并和聚合两个大表（6亿行和100万行），并将结果写入新表（8000万行）..n
Lineitems Table: 600037902 行
Suppliers Table: 1000000 行
------------------------------------------------------------------
|         s_name         |  l_partkey   | total_qty | min_qty | max_qty |
------------------------------------------------------------------
| Supplier#000543332     |  14043303    |   164.00  |  17.00  |  50.00  |
| Supplier#000162101     |   6412082    |   243.00  |   3.00  |  49.00  |
| Supplier#000170221     |   9920211    |   204.00  |  10.00  |  48.00  |
| Supplier#000652699     |   4402694    |   215.00  |   3.00  |  46.00  |
| Supplier#000635296     |   1635295    |   153.00  |   3.00  |  29.00  |
| Supplier#000915082     |   3665078    |   228.00  |   3.00  |  42.00  |
| Supplier#000624767     |  15624766    |   149.00  |  11.00  |  37.00  |
| Supplier#000899746     |   4399737    |   202.00  |   1.00  |  48.00  |
| Supplier#000285255     |   6285254    |   274.00  |  10.00  |  48.00  |
| Supplier#000052105     |  19552066    |   307.00  |   1.00  |  48.00  |
------------------------------------------------------------------
```

## 3. 通过不同计算资源（虚拟集群）完成同样的计算任务需要不同的时间，查看弹性扩缩容的效果。

```python
start_time = time.time()

# 4 - 将虚拟计算集群大小调整为 XSMALL
print(f"正在调整到 {VCLUSTER_Size} ..")

sql_cmd = f"ALTER VCLUSTER {VCLUSTER_Name} SET VCLUSTER_SIZE = '{VCLUSTER_Size}' "
session.sql(sql_cmd).collect()

print("完成！...nn")


# 5 - 将结果写入新表（8000万行）
# <-- 这是当所有之前的操作编译并作为单个作业执行时
print("正在创建目标 SALES_SUMMARY 表...nn")
dfSummary.write.mode("overwrite").saveAsTable("SALES_SUMMARY")
print("目标表已创建！...")

# 6 - 查询结果（8000万行）
print("正在查询结果...n")
dfSales = session.table("SALES_SUMMARY")
dfSales.show()
end_time = time.time()

print("--- 连接、汇总和写入结果到新表用了 %s 秒 --- n" % int(end_time - start_time))
print("--- 向 SALES_SUMMARY 表写入了 %s 行" % dfSales.count())

# 7 - 将虚拟计算集群大小减少到 XSMALL
print("将 VCLUSTER 缩小到 XS...n")
sql_cmd = "ALTER VCLUSTER {} SET VCLUSTER_SIZE = 'XSMALL'".format(VCLUSTER_Name)
session.sql(sql_cmd).collect()

print("完成！...n")

```

```
正在调整到 XSMALL ..
完成！...
正在创建目标 SALES_SUMMARY 表...
目标表已创建！...
正在查询结果...
------------------------------------------------------------------
|         s_name         |   l_partkey   | total_qty | min_qty | max_qty |
------------------------------------------------------------------
| Supplier#000966043     |   1216039     |   173.00  |  9.00   |  50.00  |
| Supplier#000986803     |  17236751     |   164.00  |  5.00   |  41.00  |
| Supplier#000081344     |    81343      |   112.00  |  7.00   |  50.00  |
| Supplier#000905118     |  12405093     |   184.00  |  1.00   |  48.00  |
| Supplier#000922670     |  14172627     |   179.00  |  6.00   |  46.00  |
| Supplier#000873089     |  12373064     |   126.00  |  9.00   |  37.00  |
| Supplier#000389530     |   9889511     |   253.00  |  1.00   |  48.00  |
| Supplier#000668325     |  14668324     |   192.00  |  4.00   |  45.00  |
| Supplier#000788387     |  11538375     |   222.00  |  7.00   |  49.00  |
| Supplier#000196264     |  13946250     |   277.00  |  5.00   |  45.00  |
------------------------------------------------------------------

--- 连接、汇总和写入结果到新表用了 75 秒 ---
--- 向 SALES_SUMMARY 表写入了 79975543 行
将 VCLUSTER 缩小到 XS...
完成！...
```

```python
start_time = time.time()

# 4 - 将虚拟计算集群大小增加到 MEDIUM
print(f"正在将 {VCLUSTER_Size} 调整为 {VCLUSTER_ReSize} ..")

sql_cmd = f"ALTER VCLUSTER {VCLUSTER_Name} SET VCLUSTER_SIZE = '{VCLUSTER_ReSize}'"
session.sql(sql_cmd).collect()

print("完成！...nn")


# 5 - 将结果写入新表（8000万行）
# <-- 这是当所有之前的操作编译并作为单个作业执行时
print("正在创建目标 SALES_SUMMARY 表...nn")
dfSummary.write.mode("overwrite").saveAsTable("SALES_SUMMARY")
print("目标表已创建！...")

# 6 - 查询结果（8000万行）
print("正在查询结果...n")
dfSales = session.table("SALES_SUMMARY")
dfSales.show()
end_time = time.time()
print("--- 连接、汇总和写入结果到新表用了 %s 秒 --- n" % int(end_time - start_time))
print("--- 向 SALES_SUMMARY 表写入了 %s 行" % dfSales.count())

# 7 - 将虚拟计算集群大小少到 XSMALL
print("将 VCLUSTER 缩小到 XSMALL...n")
sql_cmd = f"ALTER VCLUSTER {VCLUSTER_Name} SET VCLUSTER_SIZE = {VCLUSTER_Size}"
session.sql(sql_cmd).collect()

print("完成！...n")

```

```
正在将 XSMALL 调整为 MEDIUM ..
完成！...
正在创建目标 SALES_SUMMARY 表...
目标表已创建！...
正在查询结果...
------------------------------------------------------------------
|         s_name         | l_partkey  | total_qty | min_qty | max_qty |
------------------------------------------------------------------
| Supplier#000577084     |  3327080   |   220.00  |  15.00  |  49.00  |
| Supplier#000971635     | 12721622   |   263.00  |   4.00  |  50.00  |
| Supplier#000914390     |  5664384   |   113.00  |   5.00  |  38.00  |
| Supplier#000158186     |  2908183   |   241.00  |   7.00  |  46.00  |
| Supplier#000842304     | 13842303   |   180.00  |  12.00  |  40.00  |
| Supplier#000024822     |  9524803   |   181.00  |   1.00  |  48.00  |
| Supplier#000851711     |  7351696   |   346.00  |   3.00  |  50.00  |
| Supplier#000512255     |  6512254   |   250.00  |   3.00  |  50.00  |
| Supplier#000392018     | 18141999   |   164.00  |   1.00  |  48.00  |
| Supplier#000020477     |  9770467   |    81.00  |   4.00  |  25.00  |
------------------------------------------------------------------

--- 连接、汇总和写入结果到新表用了 18 秒 ---
--- 向 SALES_SUMMARY 表写入了 79975543 行
将 VCLUSTER 缩小到 XSMALL...
完成！...
```

# **Zettapark 相对于 Spark 和 PySpark 的优势**

*   **迁移快捷**：代码与 Spark/PySpark 基本相同，无需重新学习新语言。
*   **更便宜**：计算完全 Serverless 化，可以秒级扩缩容（向上/向下），并且仅在使用时运行（产生成本）。
*   **秒级即时扩缩容**：同样的计算任务，XSMALL 规格的虚拟计算集群 (VCluster) 需要约 75 秒，而 MEDIUM 规格的仅需约 20 秒。
*   **更快**：消除了所有不必要的数据移动，计算时间更短，成本更低。
*   **更易使用**：意味着更少的人力投入，因为计算和存储几乎无需维护。

^

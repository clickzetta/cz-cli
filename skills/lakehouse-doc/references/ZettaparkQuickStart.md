# Lakehouse Zettapark

Zettapark 是一个用于处理云器 Lakehouse 数据的 Python 库。它提供了一个高级的 Python API，用于在云器 Lakehouse 中执行 SQL 查询、操作数据和处理结果。Zettapark 使得在 Python 中使用云器 Lakehouse 变得更加简单和高效。你可以使用 Zettapark 执行 SQL 查询、操作数据和处理结果，就像在 Python 中使用 pandas 一样。

你也可以[下载对应的Jupyter Notebook文件](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/Zettapark_quickstart.ipynb)，方便直接运行本 Demo。

在 Zettapark 中执行 pandas 操作，会被翻译成 SQL 在云器 Lakehouse 中执行，从而实现分布式计算。

比如以下 Python 代码：

< 10)
```

在云器 Lakehouse 里执行的 SQL 是：

```
SELECT a, b FROM ( SELECT col1 AS a, col2 AS b FROM  VALUES (CAST(1 AS INT), CAST(3 AS INT)), (CAST(2 AS INT), CAST(10 AS INT))) WHERE ((a + b) < CAST(10 AS INT)) LIMIT 10;
```

## 安装clickzetta\_zettapark\_python

```
!pip install -q --upgrade clickzetta_zettapark_python -i https://pypi.tuna.tsinghua.edu.cn/simple
```

## 创建会话

使用Zettapark的第一步是与ClickZetta Lakehouse建立会话。

导入Session类。

```python
from clickzetta.zettapark.session import Session
```

和ClickZetta Connector for Python一样，Zettapark的函数中使用的相同参数（例如service、instance、用户名等）与云器Lakehouse建立会话建立会话。
dict构造一个包含这些参数的名称和值的字典 (username、password、service、instance、workspace、schema等）。

要创建会话包括如下：

```
创建一个 Python 字典 ( dict)，其中包含用于连接到 ClickZetta Lakehouse 的参数的名称和值。

将此字典传递给Session.builder.configs方法以返回具有这些连接参数的构建器对象。

create调用的方法建立builder会话。
```

以下示例使用dict包含连接参数来创建新会话：

```
hints = dict()
hints['sdk.job.timeout'] = 3
hints['query_tag'] = 'test_conn_hints_zettapark'
connection_parameters = {
  "username": "",
  "password": "",
  "service": "<region\_id>

验证会话是否创建成功：

```python
df = session.sql("show schemas;")
df.show(5)
```

```
---------------------------
|`schema_name`            |
---------------------------
|automobile               |
|automv_schema            |
|brazilianecommerce       |
|continues_computing      |
|continues_pipeline_demo  |
---------------------------
```

## 在 Zettapark Python 中使用 DataFrame

在 Zettapark 中，查询和处理数据的主要方式是通过 DataFrame。本主题介绍如何使用 DataFrame。

要检索和操作云器 Lakehouse Table 里的数据，请使用 DataFrame 类。DataFrame 表示延迟评估的关系数据集：它仅在触发特定操作时执行计算。

要将数据检索到 DataFrame 中：

```
1，构造一个 DataFrame，指定 dataset 的数据源。

例如，您可以创建一个 DataFrame 来保存来自表、外部 CSV 文件、本地数据或 SQL 语句执行的数据。

2，指定如何转换DataFrame中的数据集。

例如，您可以指定应该选择哪些列、如何过滤行、如何对结果进行排序和分组等。

3，执行语句将数据检索到 DataFrame 中。

为了将数据检索到 DataFrame 中，您必须调用执行操作的方法（例如，方法 collect()）。
```

本示例使用 DataFrame 来查询名为 `sample_product_data` 的表。如果要运行这些示例，您可以创建该表，并通过执行以下 SQL 语句向该表插入一些数据。

```python
session.sql('CREATE  TABLE if not exists sample_product_data (id INT, parent_id INT, category_id INT, name STRING, serial_number STRING, key INT, third INT)').collect()
```

```
[Row(result_message='OPERATION SUCCEED')]
```

```python
session.sql('CREATE  TABLE if not exists sample_product_data_varchar (id INT, parent_id INT, category_id INT, name STRING, serial_number VARCHAR, key INT, third INT)').collect()
```

```
[Row(result_message='OPERATION SUCCEED')]
```

```python
session.sql("""
... INSERT INTO sample_product_data_varchar VALUES
... (1, 0, 5, 'Product 1', 'prod-1', 1, 10),
... (2, 1, 5, 'Product 1A', 'prod-1-A', 1, 20),
... (3, 1, 5, 'Product 1B', 'prod-1-B', 1, 30),
... (4, 0, 10, 'Product 2', 'prod-2', 2, 40),
... (5, 4, 10, 'Product 2A', 'prod-2-A', 2, 50),
... (6, 4, 10, 'Product 2B', 'prod-2-B', 2, 60),
... (7, 0, 20, 'Product 3', 'prod-3', 3, 70),
... (8, 7, 20, 'Product 3A', 'prod-3-A', 3, 80),
... (9, 7, 20, 'Product 3B', 'prod-3-B', 3, 90),
... (10, 0, 50, 'Product 4', 'prod-4', 4, 100),
... (11, 10, 50, 'Product 4A', 'prod-4-A', 4, 100),
... (12, 10, 50, 'Product 4B', 'prod-4-B', 4, 100)
... """).collect()
```

```
[Row(result_message='OPERATION SUCCEED')]
```

验证数据插入是否成功，请运行：

```python
session.sql("SELECT count(*) FROM sample_product_data_varchar").collect()
```

```
[Row(`count`(*)=120)]
```

## 构建 DataFrame

要构造 DataFrame，可以使用 Session 类的方法和属性。以下每种方法都从不同类型的数据源构造 DataFrame。

要从表、视图或流中的数据创建 DataFrame，请调用以下 `table` 方法：

```python
# Create a DataFrame from the data in the "sample_product_data" table.
df_table = session.table("sample_product_data")
# To print out the first 10 rows
df_table.show()
```

```
---------------------------------------------------------------------------------------
|`id`  |`parent_id`  |`category_id`  |`name`      |`serial_number`  |`key`  |`third`  |
---------------------------------------------------------------------------------------
|1     |0            |5              |Product 1   |prod-1           |1      |10       |
|2     |1            |5              |Product 1A  |prod-1-A         |1      |20       |
|3     |1            |5              |Product 1B  |prod-1-B         |1      |30       |
|4     |0            |10             |Product 2   |prod-2           |2      |40       |
|5     |4            |10             |Product 2A  |prod-2-A         |2      |50       |
|6     |4            |10             |Product 2B  |prod-2-B         |2      |60       |
|7     |0            |20             |Product 3   |prod-3           |3      |70       |
|8     |7            |20             |Product 3A  |prod-3-A         |3      |80       |
|9     |7            |20             |Product 3B  |prod-3-B         |3      |90       |
|10    |0            |50             |Product 4   |prod-4           |4      |100      |
---------------------------------------------------------------------------------------
```

```python
# Create a DataFrame from the data in the "sample_product_data" table.
df_table = session.table("sample_product_data_varchar")
# To print out the first 10 rows
df_table.show()
```

```
---------------------------------------------------------------------------------------
|`id`  |`parent_id`  |`category_id`  |`name`      |`serial_number`  |`key`  |`third`  |
---------------------------------------------------------------------------------------
|1     |0            |5              |Product 1   |prod-1           |1      |10       |
|2     |1            |5              |Product 1A  |prod-1-A         |1      |20       |
|3     |1            |5              |Product 1B  |prod-1-B         |1      |30       |
|4     |0            |10             |Product 2   |prod-2           |2      |40       |
|5     |4            |10             |Product 2A  |prod-2-A         |2      |50       |
|6     |4            |10             |Product 2B  |prod-2-B         |2      |60       |
|7     |0            |20             |Product 3   |prod-3           |3      |70       |
|8     |7            |20             |Product 3A  |prod-3-A         |3      |80       |
|9     |7            |20             |Product 3B  |prod-3-B         |3      |90       |
|10    |0            |50             |Product 4   |prod-4           |4      |100      |
---------------------------------------------------------------------------------------
```

要从指定数据创建 DataFrame，请调用 `create_dataframe` 方法：

```python
# Create a DataFrame with one column named a from specified values.
df1 = session.create_dataframe([1, 2, 3, 4]).to_df("a")
df1.show()

```

```
-------
|`a`  |
-------
|1    |
|2    |
|3    |
|4    |
-------
```

创建一个具有 4 列（“a”、“b”、“c”和“d”）的 DataFrame：

```python
df2 = session.create_dataframe([[1, 2, 3, 4]], schema=["a", "b", "c", "d"])
df2.show()
```

```
-------------------------
|`a`  |`b`  |`c`  |`d`  |
-------------------------
|1    |2    |3    |4    |
-------------------------
```

创建另一个包含 4 列（“a”、“b”、“c”和“d”）的 DataFrame：

```python
from clickzetta.zettapark import Row
df3 = session.create_dataframe([Row(a=1, b=2, c=3, d=4)])
df3.show()
```

```
-------------------------
|`a`  |`b`  |`c`  |`d`  |
-------------------------
|1    |2    |3    |4    |
-------------------------
```

创建一个 DataFrame 并指定一个模式（Schema）：

```python
from clickzetta.zettapark.types import IntegerType, StringType, StructType, StructField
schema = StructType([StructField("a", IntegerType()), StructField("b", StringType())])
df4 = session.create_dataframe([[1, "click"], [3, "zetta"]], schema)
df4.show()
```

```
---------------
|`a`  |`b`    |
---------------
|1    |click  |
|3    |zetta  |
---------------
```

要创建包含一系列值的 DataFrame，请调用以下 `range` 方法：

```python
df_range = session.range(1, 10, 2).to_df("a")
df_range.show()
```

```
-------
|`a`  |
-------
|1    |
|3    |
|5    |
|7    |
|9    |
-------
```

## 对指定数据集进行转换

要指定选择哪些列以及如何对结果进行筛选、排序、分组等操作，请调用转换数据集的 DataFrame 方法。要标识这些方法中的列，请使用 `col` 函数或计算结果为列的表达式。

例如：
要指定应返回哪些行，请调用 `filter` 方法：

```python
from clickzetta.zettapark import functions as F
```

```python
df = session.table("sample_product_data").filter(F.col("id") == 1)
df.show()
```

```
--------------------------------------------------------------------------------------
|`id`  |`parent_id`  |`category_id`  |`name`     |`serial_number`  |`key`  |`third`  |
--------------------------------------------------------------------------------------
|1     |0            |5              |Product 1  |prod-1           |1      |10       |
--------------------------------------------------------------------------------------
```

要指定应选择的列，请调用 `select` 方法：

```python
# Create a DataFrame that contains the id, name, and serial_number
# columns in the "sample_product_data" table.
df = session.table("sample_product_data").select(F.col("id"), F.col("name"), F.col("serial_number"))
df.show()
```

```
---------------------------------------
|`id`  |`name`      |`serial_number`  |
---------------------------------------
|1     |Product 1   |prod-1           |
|2     |Product 1A  |prod-1-A         |
|3     |Product 1B  |prod-1-B         |
|4     |Product 2   |prod-2           |
|5     |Product 2A  |prod-2-A         |
|6     |Product 2B  |prod-2-B         |
|7     |Product 3   |prod-3           |
|8     |Product 3A  |prod-3-A         |
|9     |Product 3B  |prod-3-B         |
|10    |Product 4   |prod-4           |
---------------------------------------
```

```python
# Import the col function from the functions module.
df_product_info = session.table("sample_product_data")
df1 = df_product_info.select(df_product_info["id"], df_product_info["name"], df_product_info["serial_number"])
df2 = df_product_info.select(df_product_info.id, df_product_info.name, df_product_info.serial_number)
df3 = df_product_info.select("id", "name", "serial_number")
```

## 连接DataFrame

要连接 DataFrame 对象，请调用 `join` 方法：

```
# Create two DataFrames to join
df_lhs = session.create_dataframe([["a", 1], ["b", 2]], schema=["key", "value1"])
df_rhs = session.create_dataframe([["a", 3], ["b", 4]], schema=["key", "value2"])
# Create a DataFrame that joins the two DataFrames
# on the column named "key".
df_lhs.join(df_rhs, df_lhs.col("key") == df_rhs.col("key")).select(df_lhs["key"].as_("key"), "value1", "value2").show()
```

```
-------------------------------
|`key`  |`value1`  |`value2`  |
-------------------------------
|a      |1         |3         |
|b      |2         |4         |
-------------------------------
```

```python
import copy

df = session.table("sample_product_data")
# This fails because columns named "id" and "parent_id"
# are in the left and right DataFrames in the join.
df_copy = copy.copy(df)
df_joined = df.join(df_copy, F.col("id") == F.col("parent_id"))
```

## 指定列和表达式

调用这些转换方法时，您可能需要指定列或使用列的表达式。例如，调用 `select` 方法时，您需要指定要选择的列。

```python
df_product_info = session.table("sample_product_data").select(F.col("id"), F.col("name"))
df_product_info.show()
```

```
---------------------
|`id`  |`name`      |
---------------------
|1     |Product 1   |
|2     |Product 1A  |
|3     |Product 1B  |
|4     |Product 2   |
|5     |Product 2A  |
|6     |Product 2B  |
|7     |Product 3   |
|8     |Product 3A  |
|9     |Product 3B  |
|10    |Product 4   |
---------------------
```

在指定过滤器、投影、连接条件等时，可以在表达式中使用 Column 对象。例如：
您可以使用 Column 对象和 `filter` 方法来指定过滤条件：

```python
# Specify the equivalent of "WHERE id = 20"
# in a SQL SELECT statement.
df_filtered = df_product_info.filter(F.col("id") == 20)
df_filtered.show()
```

```
-----------------
|`id`  |`name`  |
-----------------
|      |        |
-----------------
```

```python
df = session.create_dataframe([[1, 3], [2, 10]], schema=["a", "b"])
# Specify the equivalent of "WHERE a + b < 10"
# in a SQL SELECT statement.
df_filtered = df.filter((F.col("a") + F.col("b")) < 10)
df_filtered.show()
```

```
-------------
|`a`  |`b`  |
-------------
|1    |3    |
-------------
```

## 关闭会话

```Python
session.close()
```

## 参考资料

[Zettapark Samples](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/Zettapark-examples/Notebook)

^

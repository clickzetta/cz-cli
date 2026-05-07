# 使用 Zettapark 扩展客户特征的特征工程

## 概述

本教程展示了如何使用[Zettapark](ZettaparkQuickStart.md)对[TPCH 表](sample-data-using.md)进行特征工程代码的编写。通过本教程，我们将展示如何构建派生（聚合和转换）特征，以支持多个机器学习任务。例如，您可以构建以下内容：

**客户细分/流失预测**：

* 特征数据：每位客户的总消费金额、订单数量、平均订单金额、客户人口统计信息（例如市场细分、账户余额）以及地理信息（国家/地区）。
* 方法：对订单进行聚合，并通过与客户、国家和地区表连接进行丰富。

**销售预测**：

* 特征数据：基于时间的度量，如总销售额、平均销售额、订单频率以及每位客户或每个地区的趋势。
* 方法：对订单和行项目细节进行聚合。

**供应商绩效/产品销售分析**：

* 特征数据：对于供应商，包括总可用数量、总供应成本和平均供应成本；对于产品，包括销售金额和频率，可能需要使用`CASE WHEN`对产品类型进行分类转换。
* 方法：对 partsupp、lineitem 和 part 表进行分组和聚合，并使用`CASE WHEN`转换进行领域特定的分类。

您可以从[GitHub 存储库获取源代码（Jupyter Notebook ipynb 文件）](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/FeatureEngineeringForExpandingCustomerFeatureswithZettapark.ipynb)。

## 环境设置

```python
# !pip install clickzetta_zettapark_python  -U -i https://pypi.tuna.tsinghua.edu.cn/simple
```

^
^
^

```python
from clickzetta.zettapark.session import Session
import json

import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

import pandas as pd
import json


# 从配置文件读取参数
with open('config.json', 'r') as config_file:
    config = json.load(config_file)

print("Connecting to Lakehouse.....\n")

# 创建会话
session = Session.builder.configs(config).create()

print("Connected and context as below...\n")

# print(session.sql("SELECT current_instance_id(), current_workspace(),current_workspace_id(), current_schema(), current_user(),current_user_id(), current_vcluster()").collect())
```

```
Connecting to Lakehouse.....

Connected and context as below...
```

```python
TPCH_SIZE_PARAM = 10
CLICKZETTA_SAMPLE_DB = 'clickzetta_sample_data' # 示例数据库名称可能不同...

TPCH_SCHEMA = 'tpch_100g'
  
customer = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.customer') 
lineitem = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.lineitem')  
nation = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.nation')  
orders = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.orders') 
part = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.part')  
partsupp = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.partsupp') 
region = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.region')  
supplier = session.table(f'{CLICKZETTA_SAMPLE_DB}.{TPCH_SCHEMA}.supplier')  
```

## 特征工程

```python
from clickzetta.zettapark.functions import col, when, sum as F_sum, count as F_count, avg as F_avg
from decimal import Decimal
```

### 1. 客户销售聚合

* **功能**：
  此代码按客户键对订单表进行分组，并聚合关键指标，例如每位客户的总销售额（订单总额之和）、订单数量和平均订单价值。这些聚合指标随后被重命名，并与客户表连接，将客户的个人信息（姓名、地址、账户余额等）与其购买行为集成。

* **目标**：
  构建客户级销售指标数据集，可用于进一步分析或预测建模任务，如客户细分或流失预测。

```python
# -----------------------------------------
# 1. 客户销售聚合（源自订单）
# -----------------------------------------
customer_sales_agg = orders.groupBy("O_CUSTKEY") \
    .agg(
        F_sum("O_TOTALPRICE").alias("total_sales"),
        F_count("O_ORDERKEY").alias("order_count"),
        F_avg("O_TOTALPRICE").alias("avg_order_value")
    ) \
    .withColumnRenamed("O_CUSTKEY", "customer_sk")


# 将聚合后的销售数据与客户详情连接
customer_features = customer.join(
    customer_sales_agg,
    customer["C_CUSTKEY"] == customer_sales_agg["customer_sk"],
    "left"
).select(
    customer["C_CUSTKEY"].alias("customer_sk"),
    customer["C_NAME"],
    customer["C_ADDRESS"],
    customer["C_PHONE"],
    customer["C_ACCTBAL"],
    customer["C_MKTSEGMENT"],
    customer_sales_agg["total_sales"],
    customer_sales_agg["order_count"],
    customer_sales_agg["avg_order_value"],
    customer["C_NATIONKEY"]
)

customer_features = customer_features.na.fill({
    "C_NAME": "",                        # 字符串列：空字符串
    "C_ADDRESS": "",                     # 字符串列：空字符串
    "C_PHONE": "",                       # 字符串列：空字符串
    "C_ACCTBAL": Decimal("0.00"),         # 小数(15,2)值
    "C_MKTSEGMENT": "",                  # 字符串列：空字符串
    "total_sales": Decimal("0.00"),       # 小数(25, 2)值
    "avg_order_value": Decimal("0.000000"), # 小数(19,6)值
    "order_count": 0                     # 整数
})

# 显示结果数据框（或继续进行更多特征工程）
customer_features.show()
```

```
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
|customer_sk  |c_name              |c_address                                 |c_phone          |c_acctbal  |c_mktsegment  |total_sales  |order_count  |avg_order_value  |c_nationkey  |
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
|467          |Customer#000000467  |amwRkh0nDQ6r6MU                           |21-449-581-5158  |9398.51    |MACHINERY     |1701866.04   |12           |141822.170000    |11           |
|521          |Customer#000000521  |MUEAEA1ZuvRofNY453Ckr4Apqk1GlOe           |12-539-480-8897  |5830.69    |MACHINERY     |1569375.53   |8            |196171.941250    |2            |
|475          |Customer#000000475  |JJMbj6myLUzMlbUmg63hNtFv4pWL8nq           |24-485-422-9361  |9043.55    |BUILDING      |2323455.22   |20           |116172.761000    |14           |
|511          |Customer#000000511  |lQC9KfW W77IYtJjAgSZguNzxjY rYk3t6lcxfSh  |23-247-728-9743  |4571.31    |FURNITURE     |2581114.42   |16           |161319.651250    |13           |
|130          |Customer#000000130  |RKPx2OfZy0Vn 8wGWZ7F2EAvmMORl1k8iH        |19-190-993-9281  |5073.58    |HOUSEHOLD     |3100496.60   |22           |140931.663636    |9            |
|542          |Customer#000000542  |XU2ffxnW3TQasrfF0u2KwKWmMarPyY4q7Q        |26-674-545-2517  |3109.96    |BUILDING      |2042094.45   |10           |204209.445000    |16           |
|270          |Customer#000000270  |,rdHVwNKXKAgREU                           |17-241-806-3530  |9192.50    |AUTOMOBILE    |0.00         |0            |0.000000         |7            |
|345          |Customer#000000345  |dGFK ICPKxnsAzlX4UYOUf,n200yyEWhIeG       |19-209-576-4513  |1936.77    |AUTOMOBILE    |0.00         |0            |0.000000         |9            |
|348          |Customer#000000348  |ciP7BWkhOe1IbbVGlqJePBI6ZwqENkS           |23-986-141-5327  |3310.49    |HOUSEHOLD     |0.00         |0            |0.000000         |13           |
|534          |Customer#000000534  |3PI4ZATXq8yaHFt,sZOQccGl  Fc1TA3Y 2       |11-137-389-2888  |6520.97    |AUTOMOBILE    |0.00         |0            |0.000000         |1            |
----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
```

### 2. 地理特征提取

* **功能**：
  此代码通过将包含国家键的客户特征与国家表连接，再与地区表连接，为客户数据丰富地理信息。此过程提取每个客户的国家名称和地区名称等属性。

* **目标**：
  为客户数据集添加地理维度，支持区域绩效分析，并为可能使用地理数据的模型（例如市场细分或基于位置的趋势分析）提供支持。

```python
# -----------------------------------------
# 2. 地理特征（使用国家和地区）
# -----------------------------------------
customer_geo = customer_features.join(
    nation,
    customer_features["C_NATIONKEY"] == nation["N_NATIONKEY"],
    "left"
).join(
    region,
    nation["N_REGIONKEY"] == region["R_REGIONKEY"],
    "left"
).select(
    customer_features["customer_sk"],
    nation["N_NAME"].alias("nation_name"),
    region["R_NAME"].alias("region_name"),
    customer_features["C_ACCTBAL"]
)

# 可选：聚合区域级指标
region_agg = customer_geo.groupBy("region_name") \
    .agg(
        F_count("customer_sk").alias("num_customers"),
        F_avg("C_ACCTBAL").alias("avg_acctbal")
    )
```

### 3. 产品销售特征

* **功能**：
  此代码通过按产品键对行项目表中的记录进行分组，聚合销售数据。它计算每个产品的总扩展价格、平均扩展价格和订单数量。然后，它将这些结果与产品表连接，并使用`when`函数应用条件逻辑（CASE WHEN），将产品类型转换为数值代码。

* **目标**：
  生成封装关键销售指标的产品级特征，并对产品类型进行数值编码。这些特征可用于产品绩效分析、需求预测，或集成到推荐系统中。

```python
# -----------------------------------------
# 3. 产品销售特征（源自行项目和产品）
# -----------------------------------------
product_sales = lineitem.groupBy("L_PARTKEY") \
    .agg(
        F_sum("L_EXTENDEDPRICE").alias("total_extended_price"),
        F_avg("L_EXTENDEDPRICE").alias("avg_extended_price"),
        F_count("L_ORDERKEY").alias("order_count")
    ) \
    .withColumnRenamed("L_PARTKEY", "part_sk")

# 将产品表与销售数据连接，并使用CASE WHEN转换产品类型
product_features = part.join(
    product_sales,
    part["P_PARTKEY"] == product_sales["part_sk"],
    "left"
).select(
    part["P_PARTKEY"].alias("part_sk"),
    part["P_NAME"],
    when(col("P_TYPE").like("%ECONOMY%"), 1)
      .when(col("P_TYPE").like("%STANDARD%"), 2)
      .when(col("P_TYPE").like("%PROMO%"), 3)
      .otherwise(0).alias("product_type_code"),
    product_sales["total_extended_price"],
    product_sales["avg_extended_price"],
    product_sales["order_count"]
)

# 用适当类型的默认值替换空值：
product_features = product_features.na.fill({
    "P_NAME": "",                       # 对于字符串列，使用空字符串。
    "total_extended_price": Decimal("0.00"),  # 对于DecimalType(25,2)，使用具有匹配精度的Decimal。
    "avg_extended_price": Decimal("0.000000"), # 对于DecimalType(19,6)
    "product_type_code": 0,               # 整数
    "order_count": 0                      # 整数
})

# 例如，显示结果
product_features.show()
```

```
--------------------------------------------------------------------------------------------------------------------------------
|part_sk  |p_name                                |product_type_code  |total_extended_price  |avg_extended_price  |order_count  |
--------------------------------------------------------------------------------------------------------------------------------
|270      |mint deep white navajo floral         |3                  |802805.22             |30877.123846        |26           |
|130      |gainsboro powder cyan pale rosy       |0                  |792169.97             |25553.870000        |31           |
|467      |cornflower lime midnight plum forest  |2                  |1245756.06            |32783.054211        |38           |
|348      |blush navajo peru chartreuse dim      |0                  |1016148.76            |33871.625333        |30           |
|475      |coral peru forest thistle khaki       |2                  |1174651.38            |35595.496364        |33           |
|511      |red pale plum orchid moccasin         |2                  |693051.41             |31502.336818        |22           |
|542      |light lace gainsboro coral lavender   |0                  |1103543.10            |38053.210345        |29           |
|521      |grey drab honeydew coral pale         |3                  |1317749.04            |38757.324706        |34           |
|345      |cyan frosted spring orange puff       |1                  |828151.10             |29576.825000        |28           |
|534      |bisque saddle hot steel frosted       |2                  |1326940.25            |41466.882813        |32           |
--------------------------------------------------------------------------------------------------------------------------------
```

### 4. 供应商特征

* **功能**：此部分首先按供应商键对 partsupp 表中的供应商相关数据进行聚合，计算总可用数量、总供应成本和平均供应成本等指标。然后，将这些聚合值与供应商表连接，以丰富供应商详情（名称、地址、电话）。特别注意使用与数据类型匹配的默认值处理空值。

* **目标**：构建一个全面的供应商特征数据集，反映 partsupp 中的操作指标和供应商表中的供应商身份。此数据集支持下游任务，如供应商绩效评估、风险评估和供应商分类。

```python
# -----------------------------------------
# 4. 供应商特征（源自 partsupp 和供应商）
# -----------------------------------------
supplier_metrics = partsupp.groupBy("PS_SUPPKEY") \
    .agg(
        F_sum("PS_AVAILQTY").alias("total_avail_qty"),
        F_sum("PS_SUPPLYCOST").alias("total_supply_cost"),
        F_avg("PS_SUPPLYCOST").alias("avg_supply_cost")
    ) \
    .withColumnRenamed("PS_SUPPKEY", "supplier_sk")
    
supplier_features = supplier.join(
    supplier_metrics,
    supplier["S_SUPPKEY"] == supplier_metrics["supplier_sk"],
    "left"
).select(
    supplier["S_SUPPKEY"].alias("supplier_sk"),
    supplier["S_NAME"],
    supplier["S_ADDRESS"],
    supplier["S_PHONE"],
    supplier_metrics["total_avail_qty"],
    supplier_metrics["total_supply_cost"],
    supplier_metrics["avg_supply_cost"]
)

# 在.na.fill()中使用字典来指定具有匹配数据类型的默认值。
supplier_features = supplier_features.na.fill({
    "S_NAME": "",                          # 字符串列：使用空字符串。
    "S_ADDRESS": "",                       # 字符串列：使用空字符串。
    "S_PHONE": "",                         # 字符串列：使用空字符串。
    "total_supply_cost": Decimal("0.00"),   # DecimalType(25, 2)：使用具有适当精度的 Decimal。
    "avg_supply_cost": Decimal("0.000000"), # DecimalType(19, 6)：使用具有适当精度的 Decimal。
    # "total_avail_qty" 如果是整数类型，可以保持不变。
})

# 可选：显示结果数据框
supplier_features.show()
```

```
-----------------------------------------------------------------------------------------------------------------------------------------------
|supplier_sk  |s_name              |s_address                       |s_phone          |total_avail_qty  |total_supply_cost  |avg_supply_cost  |
-----------------------------------------------------------------------------------------------------------------------------------------------
|424          |Supplier#000000424  |uOdFKME6fSAI,rvLcpTL            |32-406-948-7901  |440916           |41351.84           |516.898000       |
|423          |Supplier#000000423  |VCgMjClu4IDaVVMwMW0ARf1ho       |34-577-174-3894  |385330           |39224.80           |490.310000       |
|227          |Supplier#000000227  |Qo959Dll Bd7xvfq3ELtCq          |14-215-994-7949  |401470           |40601.39           |507.517375       |
|89           |Supplier#000000089  |fhtzZcSorhud1                   |19-259-876-1014  |403308           |38926.56           |486.582000       |
|441          |Supplier#000000441  |fvmSClCxNTIEspspva              |24-252-393-5381  |404656           |39053.50           |488.168750       |
|421          |Supplier#000000421  |tXZPR dOYjjbGjarXxKPn,1         |18-360-757-8604  |397487           |41888.22           |523.602750       |
|192          |Supplier#000000192  |Tub1t4UlJwZ5U                   |25-585-189-5975  |387833           |38340.94           |479.261750       |
|425          |Supplier#000000425  |a KnEGf,bqEnGd2Wd9Tl            |10-262-132-6639  |421867           |37923.27           |474.040875       |
|115          |Supplier#000000115  |nJ 2t0f7Ve,wL1,6WzGBJLNBUCKlsV  |33-597-248-1220  |375955           |37680.53           |471.006625       |
|144          |Supplier#000000144  |f8tddEKps816HHqNwsKdn3          |30-726-423-7363  |392087           |38941.69           |486.771125       |
-----------------------------------------------------------------------------------------------------------------------------------------------
```

### 5. 为机器学习数据集合并客户特征

* **功能**：此代码将客户销售特征与地理特征通过客户键作为连接标准进行合并。还使用`when`函数应用一系列条件转换，将客户市场细分字段转换为数值代码。这对于机器学习模型需要数值输入时至关重要。

* **目标**：创建一个集成的多维特征数据集，结合购买行为、账户信息以及地理和市场细分数据。此丰富数据集旨在用于客户细分、预测客户流失或信用风险建模等机器学习任务。

```python
# -----------------------------------------
# 5. 为机器学习数据集合并客户特征
# -----------------------------------------
# 例如，我们结合客户销售和地理特征；
# 可以使用`CASE WHEN`对市场细分字段进行数值编码。

# 显式重命名客户特征列以添加前缀
customer_features_prefixed = customer_features.select(
    col("customer_sk").alias("c_customer_sk"),
    col("total_sales").alias("c_total_sales"),
    col("order_count").alias("c_order_count"),
    col("avg_order_value").alias("c_avg_order_value"),
    col("C_ACCTBAL").alias("c_acctbal"),
    col("C_MKTSEGMENT").alias("c_mktsegment")
)

# 同样，确保客户地理特征有唯一的前缀
customer_geo_prefixed = customer_geo.select(
    col("customer_sk").alias("g_customer_sk"),
    col("nation_name").alias("g_nation_name"),
    col("region_name").alias("g_region_name")
)

customer_ml_features = customer_features_prefixed.join(
    customer_geo_prefixed,
    customer_features_prefixed["c_customer_sk"] == customer_geo_prefixed["g_customer_sk"],
    "left"
).select(
    customer_features_prefixed["c_customer_sk"].alias("customer_sk"),
    customer_features_prefixed["c_total_sales"],
    customer_features_prefixed["c_order_count"],
    customer_features_prefixed["c_avg_order_value"],
    customer_geo_prefixed["g_nation_name"].alias("nation_name"),
    customer_geo_prefixed["g_region_name"].alias("region_name"),
    customer_features_prefixed["c_acctbal"],
    when(customer_features_prefixed["c_mktsegment"] == "AUTOMOBILE", 1)
      .when(customer_features_prefixed["c_mktsegment"] == "BUILDING", 2)
      .when(customer_features_prefixed["c_mktsegment"] == "FURNITURE", 3)
      .when(customer_features_prefixed["c_mktsegment"] == "MACHINERY", 4)
      .otherwise(0).alias("mkt_segment_code")
)

customer_ml_features.show()
```

```
------------------------------------------------------------------------------------------------------------------------------
|customer_sk  |c_total_sales  |c_order_count  |c_avg_order_value  |nation_name  |region_name  |c_acctbal  |mkt_segment_code  |
------------------------------------------------------------------------------------------------------------------------------
|475          |2323455.22     |20             |116172.761000      |KENYA        |AFRICA       |9043.55    |2                 |
|467          |1701866.04     |12             |141822.170000      |IRAQ         |MIDDLE EAST  |9398.51    |4                 |
|511          |2581114.42     |16             |161319.651250      |JORDAN       |MIDDLE EAST  |4571.31    |3                 |
|521          |1569375.53     |8              |196171.941250      |BRAZIL       |AMERICA      |5830.69    |4                 |
|542          |2042094.45     |10             |204209.445000      |MOZAMBIQUE   |AFRICA       |3109.96    |2                 |
|130          |3100496.60     |22             |140931.663636      |INDONESIA    |ASIA         |5073.58    |0                 |
|270          |0.00           |0              |0.000000           |GERMANY      |EUROPE       |9192.50    |1                 |
|345          |0.00           |0              |0.000000           |INDONESIA    |ASIA         |1936.77    |1                 |
|348          |0.00           |0              |0.000000           |JORDAN       |MIDDLE EAST  |3310.49    |0                 |
|534          |0.00           |0              |0.000000           |ARGENTINA    |AMERICA      |6520.97    |1                 |
------------------------------------------------------------------------------------------------------------------------------
```

## 特征存储

```python
customer_ml_features.write.mode('overwrite').save_as_table('customer_ml_features')
```

```python
session.close()
```

## 总结与分析

### 机器学习场景和数据需求

* **客户细分/流失预测**：需要每位客户的特征（总消费、订单频率、平均订单价值、账户余额以及编码后的市场细分）以及地理信息（国家/地区）。
* **销售预测**：订单日期（源自订单/行项目）的时间维度可能会在后续步骤中与聚合后的销售数据结合，以预测未来的销售情况。
* **供应商绩效分析/产品销售预测**：通过计算聚合后的供应商指标（使用 partsupp 和供应商表）以及产品绩效（源自行项目和产品），可以构建模型来预测供应商的可靠性或评估产品销售潜力。

### 特征工程细节

* **聚合**：使用 groupBy 和聚合函数（sum、count、avg）从事务表（如订单）中计算指标（总销售额、订单数量等）。
* **丰富和连接**：集成关联信息（将客户与国家和地区表连接，将 partsupp 与供应商表连接），以附加人口统计或地理信息。
* **转换（CASE WHEN**）：使用 when 函数进行条件转换，例如将产品类型或市场细分编码为数值代码。这在机器学习模型需要数值输入时至关重要。
* **数据清理**：应用 na.fill(0) 或其他插补方法处理缺失值，确保机器学习数据集的完整性。

此代码提供了一个起点。根据具体的机器学习场景，您可能需要添加基于时间的窗口函数、更细粒度的特征拆分或特定领域的转换。祝您在探索这些特征和构建模型时一切顺利！

***

**附录**：

* [从 GitHub 存储库获取源代码](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/FeatureEngineeringForExpandingCustomerFeatureswithZettapark.ipynb)
* [获取更多 Zettapark Python API 示例](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/Zettapark-examples/Notebook)

^

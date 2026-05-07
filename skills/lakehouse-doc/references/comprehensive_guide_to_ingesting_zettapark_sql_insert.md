# 将数据导入云器Lakehouse的完整指南

## 数据入仓：通过Zettapark以SQL INSERT方式加载数据

#### 概述

云器Lakehouse提供了和PySpark兼容的[Zettapark](ZettaparkQuickStart.md)，在流行的IDE（比如VS Code）里通过Python和SQL编程的方式，将数据加载到云器Lakehouse的表里。

#### 使用场景

这种方式可以方便地运行 SQL 并上传文件，加载数据的一种方法是对每条记录执行 SQL INSERT 语句，适合在 Python 编程环境里上传少量数据。虽然这是一种方便的数据插入方式，但是对大批量数据的加载效率不高，因为云器Lakehouse并不是一个传统的数据库，而是针对写入大批量数据进行了更多优化。

#### 实现步骤

在电脑上打开VS Code，创建一个名为 [py\_zettapark\_sql\_insert.py ](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta/py_zettapark_sql_insert.py)的文件，并将以下代码复制到py\_zettapark\_sql\_insert.py文件中。

```JSON
import json,gzip
from clickzetta.zettapark.session import Session
from datetime import datetime

# 从配置文件中读取参数
with open('config-ingest.json', 'r') as config_file:
    config = json.load(config_file)

print("正在连接到云器Lakehouse.....\n")

# 创建会话
session = Session.builder.configs(config).create()

print("连接成功！...\n")

target_table_name = "lift_tuckets_import_by_py_insert"

create_target_table_query = f"""
CREATE TABLE if not exists ql_ws.ingest.{target_table_name}(
  `txid` string,
  `rfid` string,
  `resort` string,
  `purchase_time` timestamp_ltz,
  `expiration_time` date,
  `days` int,
  `name` string,
  `address_street` string,
  `address_city` string,
  `address_state` string,
  `address_postalcode` string,
  `phone` string,
  `email` string,
  `emergency_contact_name` string,
  `emergency_contact_phone` string)
"""
session.sql(create_target_table_query).collect()

def save_to_clickzetta(session, message):
    record = json.loads(message)
    print('inserting record to Clickzetta Lakehouse')

    # 转换日期和时间字段
    purchase_time = datetime.strptime(record['purchase_time'], '%Y-%m-%d %H:%M:%S')
    expiration_time = datetime.strptime(record['expiration_time'], '%Y-%m-%d').date()

    row = (
        f"'{record['txid']}'", f"'{record['rfid']}'", f"'{record['resort']}'", 
        f"timestamp_ltz '{record['purchase_time']}'", f"date '{record['expiration_time']}'", 
        record['days'], f"'{record['name']}'", f"'{record['address_street']}'", 
        f"'{record['address_city']}'", f"'{record['address_state']}'", 
        record['address_postalcode'], record['phone'], 
        f"'{record['email']}'", f"'{record['emergency_contact_name']}'", 
        record['emergency_contact_phone']
    )

    sql_query = f"""
    INSERT INTO ql_ws.ingest.{target_table_name} 
    (TXID, RFID, RESORT, PURCHASE_TIME, EXPIRATION_TIME, DAYS, NAME, ADDRESS_STREET, ADDRESS_CITY, ADDRESS_STATE, ADDRESS_POSTALCODE, PHONE, EMAIL, EMERGENCY_CONTACT_NAME, EMERGENCY_CONTACT_PHONE) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    session.sql(sql_query, row).collect()
    print(f"inserted ticket {record}")

if __name__ == "__main__":
    # 打开 JSON 文件并读取内容
    with gzip.open('lift_tickets_data.json.gz', 'rt', encoding='utf-8') as file:
        for message in file:
            if message.strip():  # 确保不是空行
                save_to_clickzetta(session, message)
    
    session.close()
    print("Ingest complete")

```

在 VS Code 里新建一个“终端”，并运行如下命令以激活在“环境设置”步骤中创建的 Python 环境。如果已在cz-ingest-examples环境里，请跳过。

```Shell
conda activate cz-ingest-examples
```

然后在同一终端里运行如下命令：

```Shell
python py_zettapark_sql_insert.py
```

#### 下一步建议

优化建议：对于加载大批量数据而言，这并不是一个高效的方法。你可以通过提高任务并发度，以及在每次 INSERT INTO 语句中插入多条记录来提高性能。

#### 资料

[SQL Insert Into](INSERT.md)

[Zettapark快速上手](ZettaparkQuickStart.md)

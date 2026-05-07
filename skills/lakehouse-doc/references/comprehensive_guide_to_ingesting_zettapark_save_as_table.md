# 将数据导入云器Lakehouse的完整指南

## 数据入仓：通过Zettapark以SAVE\_AS\_TABLE方式加载数据

#### 概述

#### 使用场景

SAVE\_AS\_TABLE方式会自动建表，从而简化了通过Zettapark以SQL INSERT方式加载数据需要手工建表的过程，同时SAVE\_AS\_TABLE会自动优化INSERT INTO，每次不是插入一条记录而是多条。

#### 实现步骤

在电脑上打开VS Code，创建一个名为 [py\_zettapark\_save\_as\_table.py ](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta/py_zettapark_save_as_table.py)的文件，并将以下代码复制到py\_zettapark\_save\_as\_table.py文件中。

```Python
import json
import gzip
from clickzetta.zettapark.session import Session
from datetime import datetime

# 从配置文件中读取参数
with open('config-ingest.json', 'r') as config_file:
    config = json.load(config_file)

print("正在连接到云器Lakehouse.....\n")

# 创建会话
session = Session.builder.configs(config).create()

print("连接成功！...\n")

target_table_name = "lift_tuckets_import_by_py_save_as_table"

def save_as_table_to_clickzetta(session, schema, data):
    print('Saving data to Clickzetta Lakehouse')

    # Convert data to dataframe
    df = session.create_dataframe(data, schema=schema)
    
    # Save dataframe as table
    df.write.save_as_table(target_table_name, mode="overwrite", table_type="transient")
    print(f"Data saved to table {target_table_name}")

if __name__ == "__main__":
    schema = None
    data = []

    # 打开压缩的 JSON 文件并读取内容
    with gzip.open('lift_tickets_data.json.gz', 'rt', encoding='utf-8') as file:
        for message in file:
            if message.strip():  # 确保不是空行
                record = json.loads(message)
                if 'schema' in record:
                    schema = record['schema']
                else:
                    data.append(record)
    
    save_as_table_to_clickzetta(session, schema, data)
    session.close()
    print("Ingest complete")
```

在VS Code里新建一个“终端”，并运行如下命令以激活在“环境设置”步骤中创建的Python环境。如果已在 `cz-ingest-examples` 环境中，请跳过此步骤。

```
conda activate cz-ingest-examples
```

然后在同一终端里运行如下命令：

```
python py_zettapark_save_as_table.py
```

#### 下一步建议

#### 资料

[Zettapark快速上手](ZettaparkQuickStart.md)

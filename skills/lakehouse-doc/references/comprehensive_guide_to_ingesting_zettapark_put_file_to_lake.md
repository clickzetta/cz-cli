# 将数据导入云器 Lakehouse 的完整指南

## 数据入湖：通过 ZettaPark PUT 文件实现数据入湖

#### 概述

通过云器 Lakehouse 提供的 ZettaPark Python 库，以 Python 编程的方式将在测试数据生成步骤中生成的数据上传到云器 Lakehouse 管理的数据湖中，实现数据入湖。

数据湖操作需要新建一个数据湖连接和 Volume，然后就可以将数据 PUT 到数据湖中。

#### 使用场景

适合熟悉 Python 编程的用户，可以借助 Python 强大的编程能力和灵活性，通过 Python 和 DataFrame 进行数据清洗、转换等数据工程与数据准备工作，特别是与 AI 分析紧密相关的数据工作。

#### 实现步骤

你也可以[直接下载文件](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/a_comprehensive_guide_to_ingesting_data_into_clickzetta/put_data_to_datalake_by_Zettapark.ipynb)到本地。

##### **将本地文件通过 Zettapark PUT 到云器 Lakehouse 管理的数据湖（Volume）**

```Python
# !pip install clickzetta_zettapark_python  -i https://pypi.tuna.tsinghua.edu.cn/simple
```

```Python
from clickzetta.zettapark.session import Session
import json,requests
import os
from datetime import datetime
```

##### **创建到云器 Lakehouse 的会话**

```Python
# 从配置文件中读取参数
with open('config/config-ingest.json', 'r') as config_file:
    config = json.load(config_file)

print("正在连接到云器Lakehouse.....\n")

# 创建会话
session = Session.builder.configs(config).create()

print("连接成功！...\n")
```

正在连接到云器 Lakehouse...

连接成功！

##### **将文件 PUT 到云器 Lakehouse 数据湖 Volume**

请将 `data/` 改为在“测试数据生成”步骤中生成的数据存放目录。

```Python
for filename in os.listdir("data/"):
        if filename.endswith(".gz"):
            file_path = os.path.join("data/", filename)
            session.file.put(file_path,"volume://ingest_demo/gz/")
        if filename.endswith(".csv"):
            file_path = os.path.join("data/", filename)
            session.file.put(file_path,"volume://ingest_demo/csv/")
        if filename.endswith(".json"):
            file_path = os.path.join("data/", filename)
            session.file.put(file_path,"volume://ingest_demo/json/")
```

```Python
# 或者上传目录下所有的文件# session.file.put("../data/","volume://ingest_demo/gz/")
```

##### **再次同步数据湖 Volume 的目录到 Lakehouse**

```Python
session.sql(alter_datalake_sql).show()
```

\---------------------

|result\_message |

\---------------------

| OPERATION SUCCEEDED |

\---------------------

##### **再次查看云器 Lakehouse 数据湖 Volume 上的文件**

```Python
results = session.sql("select * from directory(volume ingest_demo)").show()
```

\----------------------------------------------------------------------------------------------------------------------------

|relative\_path |url |size |last\_modified\_time |

\----------------------------------------------------------------------------------------------------------------------------

|gz/lift\_tickets\_data.csv.gz |oss\://yourbucketname/ingest\_demo/gz/lift\_ticket... |9717050 |2024-12-27 19:24:21+08:00 |

|gz/lift\_tickets\_data.json.gz |oss\://yourbucketname/ingest\_demo/gz/lift\_ticket... |11146044 |2024-12-27 19:24:19+08:00 |

\----------------------------------------------------------------------------------------------------------------------------

##### **测试将数据湖上文件再拉回到本地**

```Python
session.file.get("volume://ingest_demo/gz/lift_tickets_data.json.gz","tmp/gz/")
```

\[GetResult(file='tmp/gz/lift\_tickets\_data.json.gz', size=11146044, status='DOWNLOADED', message='')]

##### 校验数据湖文件的行数

数据校验：检查文件行数。查询结果为 100000，与原文件行数一致。简单从行数判断，数据入湖正确。

```Python
datalake_data_verify_sql = """
select count() from volume ingest_demo (txid string) using csv
 options(
    'header'='true',
    'sep'=',',
    'compression' = 'gzip'
 ) files('gz/lift_tickets_data.csv.gz')
 limit 10
"""
```

```Python
session.sql(datalake_data_verify_sql).show()
```

\-------------

|`count`() |

\-------------

|100000 |

\-------------

##### 查询数据湖文件里的数据

```Python
datalake_data_analytics_sql = """
select * from volume ingest_demo (txid string,name string, address_state string) using csv
 options(
    'header'='true',
    'sep'=',',
    'compression' = 'gzip'
 ) files('gz/lift_tickets_data.csv.gz')
 limit 10
"""
```

```Python
session.sql(datalake_data_analytics_sql).show()
```

\-------------------------------------------------------------------------------------

|txid |name |address\_state |

\-------------------------------------------------------------------------------------

|80a7a77b-4941-46f3-bf1a-760bb46f12da |0xbb6eabaf2eb3c3d2ea164eba |新荣记 |

|976b4512-1b07-43f4-a8e4-1fe86a7e1ee4 |0xa08ab7945cf87fc0b5095dc |大董烤鸭 |

|4c49f5cc-0bd4-4a7e-8f61-f4a501a0dd24 |0xdf7bd805b890815a4e0a008c |京雅堂 |

|8579071f-1c8b-4214-9a4d-096e6403bc52 |0x3113aa5ae86c522f3176829e |新大陆中餐厅 |

|31962471-ad3b-463d-ab36-d1b1ab041a36 |0x28c6168f44e09cacd82ecfe9 |顺峰海鲜酒家 |

|f253d271-092d-4261-8703-a440cc149c39 |0xab306bea9de6a13426361153 |长安壹号 |

|5e52e443-2c03-4ce2-a95d-992d7cb3f54e |0x52000c48116d3a4667c3b607 |御宝轩 |

|e45f3806-972c-4617-b4ab-f2cbfc449de1 |0x247dd8c03cab559125a63d1b |店客店来 |

|9abeadfa-ecac-42fb-9dd7-33377e2e5387 |0x9824bf4d4f7e12590f692148 |川办餐厅 |

|c8938377-27a0-4f1f-9800-00c169729fd3 |0x4b65182989de9a3d13943b10 |南门火锅 |

\-------------------------------------------------------------------------------------

##### 关闭Zettapark会话

```Python
session.close()
```

#### 下一步建议

* 通过 ZettaPark 以 DataFrame 的方式清洗和转换数据
* 在 Python 代码中调用 ML、LLM 相关接口，深度整合 Data + AI
* 在云器 Lakehouse Studio 里以 SQL 方式分析数据湖文件里的数据

#### 资料

[Zettapark快速上手](ZettaparkQuickStart.md)

^

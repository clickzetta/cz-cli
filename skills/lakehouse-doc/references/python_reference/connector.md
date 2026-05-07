# ClickZetta Connector 官方 Python SDK

`clickzetta-connector` 是云器 ClickZetta Lakehouse 的官方 Python SDK，遵循 PEP-249 规范，提供了一个符合 Python Database API 风格的 SQL 调用接口。通过使用该接口，您可以轻松地在 Python 应用程序中执行 SQL 查询、插入、更新和删除操作。
它还支持批量数据上传（bulkload）功能，可以大幅提高数据导入速度，这对于处理大量数据的场景尤为有用。

### 使用示例

0. 删除旧版本依赖

如果已安装旧版本的 SDK，请先卸载以避免冲突：

```shell
pip uninstall clickzetta-connector clickzetta-connector-python clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 -y
```

> 卸载前请记录旧版本的包信息，以防需要回退。查看已安装包版本的命令：

```shell
pip show clickzetta-connector clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 clickzetta-connector-python
```


1. 安装 clickzetta-connector，Python 版本要求 (>= 3.7)：

```shell
pip install clickzetta-connector
```

## 快速开始

### 执行 SQL 查询

以下是一个简单的示例，展示了如何使用 `clickzetta-connector` 执行 SQL 查询：

```python
from clickzetta import connect

### 建立连接
conn = connect(
    username='your_username',
    password='your_password',
    service='region_id.api.clickzetta.com',
    instance='your_instance',
    workspace='your_workspace',
    schema='public',
    vcluster='default'
)

```

| **参数**    | **是否必填** | **描述**                                                                                                                              |
|-----------|----------| ----------------------------------------------------------------------------------------------------------------------------------- |
| username  | Y        | 用户名                                                                                                                                 |
| password  | Y        | 密码                                                                                                                                  |
| service   | Y        | 连接 Lakehouse 的地址，region\_id.api.clickzetta.com。可以在 Lakehouse Studio 管理 -> 工作空间中看到 JDBC 连接串![](../.topwrite/assets/image_1728887857029.png) |
| instance  | Y        | 可以在 Lakehouse Studio 管理 -> 工作空间中查看 JDBC 连接串获取![](../.topwrite/assets/image_1729051500396.png)                                            |
| workspace | Y        | 使用的工作空间                                                                                                                             |
| vcluster  | Y        | 使用的 VC                                                                                                                               |
| schema    | Y        | 访问的 schema 名                                                                                                                          |
| protocol  | N        | 默认值为 'https'，支持 'http' 和 'https'                                                                                                     |

### 简单查询案例

```python
#创建游标对象
cursor = conn.cursor()
#执行 SQL 查询
cursor.execute('SELECT * FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live LIMIT 10;')
#获取查询结果
results = cursor.fetchall()
for row in results:
print(row)
```

### 使用 SQL hints

在 JDBC 中通过 set 命令设置的 SQL hints 可以通过 `parameters` 参数传递，支持的参数请参考 [参数管理](../sql-parmaters.md)。以下是一个示例：

```python
#设置作业运行超时时间为 30 秒
my_param = {
    'hints': {
        'sdk.job.timeout': 30
    }
}
cursor.execute('YOUR_SQL_QUERY', parameters=my_param)
```

### 使用

## 更多示例

### 1. 处理查询结果

以下示例展示了如何处理查询结果，例如将结果保存到 CSV 文件中：

```python
import csv

# 执行查询
cursor.execute('SELECT * FROM clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live LIMIT 10;')

# 获取查询结果
results = cursor.fetchall()

# 将结果保存到 CSV 文件
with open('output.csv', 'w', newline='', encoding='utf-8') as csvfile:
    csv_writer = csv.writer(csvfile)
    csv_writer.writerow([column[0] for column in cursor.description])
    csv_writer.writerows(results)
# 关闭连接
cursor.close()
conn.close()
```

### 高级功能

> 注意：以下高级功能需要使用 `clickzetta-connector-python >= 0.8.82` 版本，或者 clickzetta-connector 版本 >= 1.0.11。

#### 参数绑定

clickzetta-connector 支持两种参数绑定风格，遵循 [PEP-249](https://peps.python.org/pep-0249/#paramstyle) 规范：

| paramstyle | 描述                             | 示例                                    |
| ---------- | ------------------------------ | ------------------------------------- |
| qmark      | 使用问号 (?) 作为参数占位符                | `INSERT INTO test VALUES (?)`         |
| pyformat   | 使用 Python 扩展格式代码，例如 `%(name)s` | `INSERT INTO test VALUES (%(value)s)` |

##### 使用问号风格 (qmark)

```python
# 简单示例
cursor.execute('INSERT INTO test (id, name) VALUES (?, ?)', binding_params=[1, 'test'])

# JSON 类型示例
json_data = "JSON '" + '{"id": 2, "value": "100", "comment": "JSON Sample data"}' + "'"
my_param = {
    'hints': {
        'sdk.job.timeout': 30
    }
}
cursor.execute('INSERT INTO test (id, json_col) VALUES (?, ?)', my_param, binding_params=[1, json_data])
```

##### 使用 qmark 风格批量插入

使用 `executemany()` 方法支持高效地使用 qmark 风格执行批量插入操作：

```python
# 准备数据
data = [
    (1, 'test1'),
    (2, 'test2'),
    (3, 'test3')
]

# 执行批量插入
cursor.executemany('INSERT INTO test (id, name) VALUES (?, ?)', data)
```

如需对输入的数据根据表结构进行自动转换，请开启 `tolerant` 参数并指定类型：

```python
# 准备数据
data = [
    (1, 'test1'),
    (2, 0),
    (3, 0.1)
]

hints = {'hints': {
    "cz.sql.type.conversion": "tolerant"
}}

# 执行批量插入
cursor.executemany('INSERT INTO test (id, name) VALUES (int(?), string(?))', data, hints)
```

##### 使用 Python 格式风格 (pyformat)

```python
# 使用命名参数
data = {'id': 1, 'name': 'test'}
cursor.execute('INSERT INTO test (id, name) VALUES (%(id)s, "%(name)s")', data)
```

> 注意：在 pyformat 风格中，参数值为字符串时插入需要加引号。

##### 完整示例：复杂数据类型的批量插入

以下示例展示了如何使用 `executemany` 插入包含各种数据类型的数据：

```python
table = 'test_table'
cursor.execute(f'''
    CREATE TABLE {table} (
        c_bigint BIGINT,
        c_boolean BOOLEAN,
        c_binary BINARY,
        c_char CHAR,
        c_date DATE,
        c_decimal DECIMAL(20, 6),
        c_double DOUBLE,
        c_float FLOAT,
        c_int INT,
        c_interval INTERVAL DAY,
        c_smallint SMALLINT,
        c_string STRING,
        c_timestamp TIMESTAMP,
        c_tinyint TINYINT,
        c_array ARRAY<STRUCT<a: INT, b: STRING>>,
        c_map MAP<STRING, STRING>,
        c_struct STRUCT<a: INT, b: STRING, c: DOUBLE>,
        c_varchar VARCHAR(1024),
        c_json JSON
    )
''')

data = [
    (
        1,
        True,
        b'\x01',
        'a',
        datetime.date(2022, 2, 1),
        1000.123456,
        2.0,
        1.5,
        42,
        'INTERVAL 1 DAY',
        103,
        'test string 1',
        datetime.datetime.now(),
        11,
        [(1, 'A')],
        {'key1': 'value1'},
        (1, 'A', 2.0),
        'varchar example 1',
        ("JSON '" + '{"id": 2, "value": "100", "comment": "JSON Sample data"}' + "'")
    )
]
sql = f'''
    INSERT INTO {table} (
        c_bigint, c_boolean, c_binary, c_char, c_date, c_decimal, c_double, 
        c_float, c_int, c_interval, c_smallint, c_string, c_timestamp, 
        c_tinyint, c_array, c_map, c_struct, c_varchar, c_json
    ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
'''

cursor.executemany(sql, data)
my_param = {'hints': {}}

# 获取结果
cursor.execute(f'SELECT * FROM {table}', my_param)
result = cursor.fetchall()
```

#### 异步执行 (execute\_async)

`execute_async()` 方法支持异步执行 SQL 查询，特别适用于长时间运行的查询：

```python
# 异步执行查询
cursor.execute_async('SELECT * FROM large_table')

# 检查查询是否完成
while not cursor.is_job_finished():
    print("查询执行中...")
    time.sleep(1)

# 获取结果
results = cursor.fetchall()
```

#### 注意事项

* 不支持 commit 和 rollback 接口

^

# 数据导入Lakehouse操作实践\_通过Python脚本

在现代数据处理中，将数据导入数据库是一个常见的需求。使用 Python 脚本实现数据导入可以带来许多优势，适用于多种场景，例如自动化、数据处理、支持多种数据库等。本文将以 PostgreSQL 数据库为例，演示如何将数据导入云器 Lakehouse。

## 优势介绍

1. **自动化**：通过创建定期或按需运行的自动化任务，可以实现数据的实时更新或迁移。

2. **数据处理**：Python 具有强大的数据处理功能，可以在将数据导入数据库之前对其进行预处理、清洗和转换，以提高数据质量与导入成功率。

3. **支持多种数据库**：Python 提供了广泛的数据库驱动程序和库，支持关系型数据库（如 MySQL、PostgreSQL、SQLite 等）和非关系型数据库（如 MongoDB、Redis 等）。

4. **错误处理和日志记录**：使用 Python 编写导入脚本时，可以捕获异常并记录详细日志，从而更容易地跟踪和解决数据导入过程中的问题。

## 适用场景举例

1. 将 CSV 或 Excel 文件中的数据导入数据库。
2. 在将数据导入数据库之前，对数据应用统计方法或规范化等方法进行预处理。
3. 包含数据验证和完整性检查的数据库迁移任务。

## 操作指南

### 1. 导入需要的Python包

```python
from sqlalchemy import create_engine
import pandas as pd
import psycopg2
import pygwalker as pyg
```

### 2. 创建连接到 PostgreSQL 数据库并读取源表数据

```python
def create_conn_pg(database: str, user: str, password: str, host: str, port: str):
    connection = psycopg2.connect(
        dbname=database,
        user=user,
        password=password,
        host=host,
        port=port
    )
    return connection
```

### 3. 使用 `pd.read_sql_query()` 方法从数据库中查询数据并存储到 DataFrame 中

```python
conn_pg = create_conn_pg("<database>", "<username>", "<password>", "<host>", "<port>")
query = "SELECT * FROM public.orders;"
df = pd.read_sql_query(query, conn_pg)
conn_pg.close()
```

### 4. 查看 PostgreSQL 数据并进行清洗与可视化分析

```python
# 查看数据总行数
print(df.shape[0])

# 替换所有nan值为0
df.fillna(0, inplace=True)

# 显示前5行数据
print(df.head(5))
```

### 5. 使用 PyGWalker 进行数据透视分析（可选）

```python
walker = pyg.walk(df)
```

### 6. 在 ClickZetta Lakehouse 中创建目标表

```python
engine_cz = create_engine("clickzetta://<username>:<password>@<instanceid>.<region_id>.api.clickzetta.com/<workspacename>?virtualcluster=<vcluster>&schema=<public>")
sql_cz = text("""
CREATE TABLE IF NOT EXISTS orders_tmp (
    id INT,
    user_id INT,
    product_id INT,
    subtotal DECIMAL(8, 2),
    tax DECIMAL(8, 2),
    total DECIMAL(16, 3),
    discount DECIMAL(8, 2),
    created_at TIMESTAMP,
    quantity INT
);
""")
with engine_cz.connect() as conn:
    results = conn.execute(sql_cz)
```

### 7. 将转换后的源表数据写入云器 Lakehouse 目标表

```python
conn_cz = connect(
    username="<username>",
    password="<password>",
    service="<region_id>.api.clickzetta.com",
    instance="<instanceid>",
    workspace="<workspacename>",
    schema="public",
    vcluster="default"
)
bulkload_stream = conn_cz.create_bulkload_stream(schema="public", table="orders")
writer = bulkload_stream.open_writer(0)
for index, row_data in df.iterrows():
    row = writer.create_row()
    row.set_value("id", row_data["id"])
    row.set_value("created_at", row_data["created_at"])
    row.set_value("user_id", row_data["user_id"])
    row.set_value("product_id", row_data["product_id"])
    row.set_value("subtotal", row_data["subtotal"])
    row.set_value("tax", row_data["tax"])
    row.set_value("total", row_data["total"])
    row.set_value("discount", row_data["discount"])
    row.set_value("quantity", row_data["quantity"])
    writer.write(row)
writer.close()
bulkload_stream.commit()
```

### 8. 资源清理

```
#删除云器 Lakehouse目标表
sql_cz = text("""drop table if exists orders ;""")
with engine_cz.connect() as conn:
    results = conn.execute(sql_cz)
```

^

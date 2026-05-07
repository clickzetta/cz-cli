# ClickZetta SQLAlchemy 适配器

`clickzetta-connector` 是 SQLAlchemy 的 ClickZetta Lakehouse dialect 适配器，它允许使用 SQLAlchemy 接口编写的代码或上层应用轻松地与 ClickZetta Lakehouse 进行交互。

## 安装

0. 删除旧版本依赖

如果已安装旧版本的 SDK，请先卸载以避免冲突：

```shell
pip uninstall clickzetta-connector clickzetta-connector-python clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 -y
```

> 卸载前请记录旧版本的包信息，以防需要回退。查看已安装包版本的命令：

```shell
pip show clickzetta-connector clickzetta-sqlalchemy clickzetta-ingestion-python clickzetta-ingestion-python-v2 clickzetta-connector-python
```

通过 pip 安装 `clickzetta-connector`：

```shell
pip install clickzetta-connector -U
```

## 快速入门

### 执行 SQL 查询

```python
from sqlalchemy import create_engine
from sqlalchemy import text

# 创建 ClickZetta Lakehouse 的 SQLAlchemy 引擎实例
engine = create_engine(
    "clickzetta://username:password@instance.region_id.api.clickzetta.com/workspace?schema=schema&vcluster=default"
)

# 执行 SQL 查询
sql = text("SELECT * FROM ecommerce_events_multicategorystore_live;")

# 使用引擎执行查询
with engine.connect() as conn:
    result = conn.execute(sql)
    for row in result:
        print(row)
```

### 示例：使用 PyGWalker 对 Lakehouse 数据进行可视化分析

[PyGWalker](https://github.com/Kanaries/pygwalker) 是一个可以将 pandas 和 polars 数据框转换为 Tableau 风格用户界面的工具，用于数据可视化探索。它简化了 Jupyter Notebook 的数据分析和数据可视化工作流程，只需添加一行代码即可实现。

```python
from sqlalchemy import create_engine
from sqlalchemy import text
import pandas as pd
import pygwalker as pyg

# 创建 ClickZetta Lakehouse 的 SQLAlchemy 引擎实例
engine = create_engine(
    "clickzetta://username:password@instance.region_id.api.clickzetta.com/workspace?schema=schema&vcluster=default"
)

# 执行 SQL 查询
sql = text("SELECT * FROM ecommerce_events_multicategorystore_live;")

# 使用引擎执行查询并获取结果
with engine.connect() as conn:
    result = conn.execute(sql)
    df = pd.DataFrame(result.fetchall(), columns=result.keys())

# 使用 PyGWalker 对 DataFrame 进行可视化分析
walker = pyg.walk(df)
```

^

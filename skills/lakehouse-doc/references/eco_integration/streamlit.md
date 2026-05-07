# 使用 Streamlit 开发 ClickZetta Lakehouse 应用

## Streamlit 简介

Streamlit 是一款功能强大的 Python 框架，专为数据科学家和工程师打造，用于快速创建交互式 Web 应用。通过 Streamlit，您可以轻松地将数据分析、机器学习模型和数据可视化整合到一个应用中，而无需深入了解前端技术。Streamlit 的主要特点包括：

* 简洁明了的 API，便于上手，无需前端知识。
* 支持 Markdown 和 HTML 文本渲染，实现丰富的文本效果。
* 提供丰富的交互组件，如表格、图表等，支持响应式布局。
* 活跃的社区支持和持续更新。

## 开发流程概述

Streamlit 应用的开发过程非常简单。本文档将通过一个示例，展示如何结合 Streamlit 和 clickzetta-sqlalchemy 库，实现一个简单的查询 ClickZetta Lakehouse 并展示结果的应用。

### 环境准备

首先，确保您的 Python 环境中已安装 `streamlit` 和 `clickzetta-sqlalchemy`。使用以下命令进行安装：

```bash
pip install streamlit clickzetta-sqlalchemy
```

接下来，在 Streamlit 的 `secrets.toml` 配置文件（位于项目目录或 `$HOME/.streamlit/secrets.toml`）中，添加 SQLAlchemy 风格的连接字符串：

```toml
# .streamlit/secrets.toml

[connections.connection_name]
url = "clickzetta://username:password@instance.api.clickzetta.com/quickstart_ws?schema=public&virtualcluster=default"
```

### 编写应用代码

创建一个名为 `demo.py` 的文件，并编写以下代码：

```python
# demo.py
import streamlit as st

# 根据 secrets.toml 中的配置创建 SQL 连接。
conn = st.experimental_connection('connection_name', type='sql')

# 输入 SQL 查询语句。
sql = st.text_area('在这里输入您的 SQL 查询语句')

# 执行查询并展示结果。
if st.button('运行查询') and sql:
    result = conn.query(sql)
    st.dataframe(result)
```

### 运行应用

使用以下命令运行应用：

```bash
streamlit run demo.py
```

Streamlit 会自动打开本地浏览器，访问 <http://localhost:8501>。您也可以手动在浏览器中输入该地址。

### 示例 SQL 查询

以下是一个示例 SQL 查询，用于从 ClickZetta Lakehouse 中获取最近 24 小时内的购买事件数据：

```sql
SELECT
  brand,
  COUNT(DISTINCT user_id) AS unique_user_count,
  SUM(price) AS sum_price
FROM
  clickzetta_sample_data.ecommerce_events_history.ecommerce_events_multicategorystore_live
WHERE
  event_time >= (NOW() - INTERVAL '24' HOUR)
  AND event_type = 'purchase'
GROUP BY
  brand
ORDER BY
  sum_price DESC
LIMIT 10;
```

![Streamlit 应用运行效果截图](streamlit-demo.png)

## 进阶示例

### 添加图表展示

为了更好地展示数据，您可以使用 Streamlit 的 `st.plotly_chart` 函数，将查询结果以图表形式展示。首先，安装 `pandas` 和 `plotly` 库：

```bash
pip install pandas plotly
```

然后，在 `demo.py` 中添加以下代码：

```python
import pandas as pd
import plotly.express as px

# ...

if st.button('生成图表') and sql:
    result = conn.query(sql)
    df = pd.DataFrame(result)

    fig = px.bar(df, x='brand', y='sum_price', title='各品牌销售额')
    st.plotly_chart(fig)
```

## 参考资源

* [Streamlit 官方文档](https://docs.streamlit.io/library/get-started)
* [ClickZetta Lakehouse 官方文档](https://docs.clickzetta.com/lakehouse/)

^

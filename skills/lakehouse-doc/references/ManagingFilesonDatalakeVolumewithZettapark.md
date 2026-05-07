# 使用 Zettapark 管理 Lakehouse Volume 的文件

## 1. 概述

云器 Lakehouse 通过其抽象存储层（[Volume](datalake_volume.md)、[Schema](SCHEMA.md) 和 [表](Tables.md)）和 Python API，提供对数据湖文件和数据仓库表的统一管理。本指南展示了如何在数据湖中执行文件管理操作，包括上传（PUT）、下载（GET）和列出（LIST）文件。

**关键概念**：

* **Volume存储抽象**：所有数据湖存储都映射到Volume对象。
  * [External Volume](external_volume.md)：由客户管理，支持与 AWS S3 和阿里云 OSS 等云存储的集成。
  * [Internal Volume](internal_volume.md)：由云器管理，分为USER VOLUME 和 TABLE VOLUME。
* [Zettapark](ZettaparkQuickStart.md) **Python API**：提供文件和表集成的统一接口。

你可以从[GitHub 存储库获取源代码（Jupyter Notebook ipynb 文件）](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/Managing%20Files%20on%20Datalake%20Volume%20with%20Zettapark.ipynb)。

## 2. 环境设置

### 1. 安装依赖项

```bash
pip install clickzetta_zettapark_python -U -i https://pypi.tuna.tsinghua.edu.cn/simple
```

### 2. 导入库并创建会话

```python
from clickzetta.zettapark.session import Session
import json

# 从配置文件加载连接参数
with open('config.json', 'r') as config_file:
    config = json.load(config_file)

# 创建会话
session = Session.builder.configs(config).create()
print("会话创建成功！")
```

## 3. 文件操作

### 1. 清理USER VOLUME

在开始之前，清理USER VOLUME以确保环境干净：

```python
session.sql("REMOVE USER VOLUME SUBDIRECTORY '/'").show()
```

### 2. 列出USER VOLUME中的文件

确认用户卷为空：

```python
session.sql("LIST USER VOLUME").show(10)
```

### 3. 上传文件到USER VOLUME

根据文件类型将本地文件上传到用户卷的不同目录：

```python
import os

# 遍历本地目录并上传文件
for filename in os.listdir("data/"):
    if filename.endswith("csv.gz"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/csvgz/")
    elif filename.endswith(".csv"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/csv/")
    elif filename.endswith(".json"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/json/")
    elif filename.endswith(".png"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/png/")
    elif filename.endswith(".jpg"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/jpg/")
    elif filename.endswith(".pdf"):
        file_path = os.path.join("data/", filename)
        session.file.put(file_path, "volume:user://~/pdf/")
```

### 4. 验证上传结果

确认文件已成功上传：

```python
session.sql("LIST USER VOLUME").show(100)
```

## 4. 查看和下载文件

### 1. 下载图像文件

从用户卷下载图像并显示：

```python
from PIL import Image

# 将图像下载到本地目录
source_path = "volume:user://~/png/unstructured_tables.png"
dest_path = "tmp/png/"
session.file.get(source_path, dest_path)

# 打开并显示图像
try:
    img = Image.open(dest_path + "unstructured_tables.png")
    img.show()  # 显示图像
except FileNotFoundError:
    print(f"错误：文件 {dest_path} 不存在。请检查路径。")
except Exception as e:
    print(f"无法打开图像：{str(e)}")
```

## 5. 关闭会话

完成操作后，关闭会话以释放资源：

```python
session.close()
print("会话已关闭。")
```

## 6. 总结

通过本指南，你已学习如何：

1. 使用 Python API 管理用户卷中的文件。
2. 在数据湖中上传、下载和列出文件。
3. 查看图像文件并验证操作结果。

**下一步**：

* 探索卷的使用，实现文件和表的无缝集成。
* 尝试对文件和表运行联合查询，体验统一 Lakehouse 的优势。

## 附录

* [从 GitHub 存储库获取源代码](https://github.com/yunqiqiliang/clickzetta_quickstart/blob/main/Zettapark/Managing%20Files%20on%20Datalake%20Volume%20with%20Zettapark.ipynb)
* [获取更多 Zettapark Python API 示例](https://github.com/yunqiqiliang/clickzetta_quickstart/tree/main/Zettapark-examples/Notebook)

^

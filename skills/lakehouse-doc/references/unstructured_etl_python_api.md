# 云器 Lakehouse Unstructured ETL Python API 参考文档

## 架构概览

### 系统组件关系

系统采用分层架构，各组件职责清晰：

```
┌──────────────────────────────────────────────────────────┐
│                    Application Layer                     │
│    RAG    KB    Search    BI    DataSci    APIs          │
└──────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────┐
│                  ETL Processing Layer                    │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│ │Unstructured │ │ DashScope   │ │   Data Pipeline     │  │
│ │             │ │             │ │                     │  │
│ │  Doc Parse  │ │  Embedding  │ │      Quality        │  │
│ │  Chunking   │ │  4 Models   │ │     Transform       │  │
│ │  Multi-Src  │ │   Batch     │ │     Metadata        │  │
│ └─────────────┘ └─────────────┘ └─────────────────────┘  │
└──────────────────────────────────────────────────────────┘
                            ↓
┌──────────────────────────────────────────────────────────┐
│               Yunqi Lakehouse Platform                   │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐  │
│ │Compute Layer│ │Storage Layer│ │   Service Layer     │  │
│ │             │ │             │ │                     │  │
│ │ General VC  │ │ User Volume │ │     Metadata        │  │
│ │ Analytics   │ │ Table Vol   │ │   Access Ctrl       │  │
│ │ Integration │ │ Named Vol   │ │   Scheduling        │  │
│ │ Vector Idx  │ │ SQL Storage │ │   Monitoring        │  │
│ └─────────────┘ └─────────────┘ └─────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 数据流模式

#### 1. 批量ETL模式
```
┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Volume Source│→ │  Index   │→ │ Download │→ │Document  │→ │ Chunk    │→ │ Vector   │→ │SQL Store │
│             │  │  Scan    │  │          │  │ Parse    │  │Process   │  │Generate  │  │          │
│ File Scan   │  │Metadata  │  │ Local    │  │ Doc      │  │ Text     │  │ Vector   │  │ Table    │
│ Recursive   │  │Extract   │  │ Cache    │  │ Split    │  │ Blocks   │  │Generate  │  │ Insert   │
└─────────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```
- **适用场景**: 大批量文档处理、离线数据湖构建
- **计算资源**: 通用型 VCluster + 大规格 CRU
- **存储模式**: Named Volume → SQL 表 + 向量列

#### 2. 实时流处理模式
```
┌─────────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│Stream Source│→ │ Receive  │→ │ Process  │→ │Vectorize │→ │ Update   │→ │ Search   │
│             │  │          │  │          │  │          │  │          │  │          │
│Stream Input │  │ Buffer   │  │Increment │  │Embedding │  │ Live     │  │ Online   │
│ Data Feed   │  │ Queue    │  │Transform │  │Generate  │  │ Sync     │  │Retrieval │
└─────────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```
- **适用场景**: 实时知识库更新、在线 RAG 系统
- **计算资源**: 分析型 VCluster + 多实例弹缩
- **存储模式**: Table Volume + 实时 SQL 更新

#### 3. 混合处理模式
```
┌─────────────┐
│Batch Process│ ┐
│             │ │  ┌──────────────────┐    ┌──────────────┐
│Historical   │ ├─→│ Unified Vector   │ ──→│ Hybrid       │
│Data Process │ │  │ Space            │    │ Search       │
└─────────────┘ │  │                  │    │              │
┌─────────────┐ │  │ Combined         │    │ Vector +     │
│Stream Update│ ┘  │ Vector Index     │    │ Text Search  │
│             │    │                  │    │              │
│Real-time    │    └──────────────────┘    └──────────────┘
│Process      │
└─────────────┘
```
- **适用场景**: 企业级知识管理、智能客服系统
- **计算资源**: 多类型 VCluster 协同工作
- **存储模式**: 多层 Volume + 统一 SQL 视图

## 核心类和接口

### 云器 Lakehouse SQL 连接器

#### ClickzettaConnectionConfig

数据库连接配置类。

```python
class ClickzettaConnectionConfig(SqlConnectionConfig):
    """云器 Lakehouse 数据库连接配置"""

    def __init__(
        self,
        service: Optional[str] = None,
        username: Optional[str] = None,
        workspace: Optional[str] = None,
        vcluster: Optional[str] = None,
        schema: Optional[str] = None,
        instance: Optional[str] = None,
        access_config: Optional[ClickzettaAccessConfig] = None
    ):
        """
        Args:
            service: 云器 Lakehouse 服务地址
            username: 用户名
            workspace: 工作空间名称
            vcluster: 虚拟集群名称
            schema: 数据库模式名称
            instance: 实例名称
            access_config: 访问配置（包含密码等敏感信息）
        """
```

**方法：**

- `get_session() -> Session`: 创建数据库会话
- `wrap_error(e: Exception) -> Exception`: 包装异常信息

#### ClickzettaIndexerConfig

索引器配置类，用于定义数据提取参数。

```python
class ClickzettaIndexerConfig(SqlIndexerConfig):
    """云器 Lakehouse 索引器配置"""

    table_name: str  # 表名
    id_column: str = "id"  # 主键列名
    batch_size: int = 1000  # 批处理大小
    where_clause: Optional[str] = None  # WHERE 条件子句
```

#### ClickzettaIndexer

数据索引器，用于按批次获取数据。

```python
class ClickzettaIndexer(SqlIndexer):
    """云器 Lakehouse 数据索引器"""

    def run(self) -> Generator[FileData, None, None]:
        """
        运行索引器，按批次返回数据

        Yields:
            FileData: 每个批次的文件数据对象
        """
```

#### ClickzettaDownloaderConfig

下载器配置类。

```python
class ClickzettaDownloaderConfig(SqlDownloaderConfig):
    """云器 Lakehouse 下载器配置"""

    fields: List[str]  # 要下载的字段列表
    download_dir: Path  # 下载目录
    where_clause: Optional[str] = None  # 额外的WHERE条件
```

#### ClickzettaDownloader

数据下载器，将索引的数据下载到本地。

```python
class ClickzettaDownloader(SqlDownloader):
    """云器 Lakehouse 数据下载器"""

    def run(self, file_data: FileData) -> List[Dict[str, Any]]:
        """
        下载指定批次的数据

        Args:
            file_data: 索引器返回的文件数据对象

        Returns:
            List[Dict]: 下载的数据记录列表
        """

    async def run_async(self, file_data: FileData) -> List[Dict[str, Any]]:
        """异步版本的下载方法"""
```

#### ClickzettaUploaderConfig

上传器配置类。

```python
class ClickzettaUploaderConfig(SqlUploaderConfig):
    """云器 Lakehouse 上传器配置"""

    table_name: str  # 目标表名
    batch_size: int = 100  # 批量上传大小
    vector_column: Optional[str] = None  # 向量列名
    vector_dimension: Optional[int] = None  # 向量维度
    create_table_if_not_exists: bool = True  # 自动创建表
```

#### ClickzettaUploader

数据上传器，将处理后的数据上传到云器 Lakehouse。

```python
class ClickzettaUploader(SqlUploader):
    """云器 Lakehouse 数据上传器"""

    def upload_batch(self, data: List[Dict[str, Any]]) -> None:
        """
        批量上传数据

        Args:
            data: 要上传的数据记录列表
        """

    async def upload_batch_async(self, data: List[Dict[str, Any]]) -> None:
        """异步批量上传"""

    def _upload_data_batch(
        self,
        data: List[Dict[str, Any]],
        file_data: FileData
    ) -> None:
        """内部批量上传方法"""
```

### 云器 Lakehouse Volume 连接器

#### ClickzettaVolumeConnectionConfig

Volume 连接配置类。

```python
class ClickzettaVolumeConnectionConfig(FsspecConnectionConfig):
    """云器 Lakehouse Volume 连接配置"""

    def get_client(self, protocol: str = "s3") -> Generator[Session, None, None]:
        """
        获取云器 Lakehouse 会话客户端

        Args:
            protocol: 协议类型（默认 s3）

        Yields:
            Session: 云器 Lakehouse 会话对象
        """
```

#### ClickzettaVolumeIndexerConfig

Volume 索引器配置类。

```python
class ClickzettaVolumeIndexerConfig(FsspecIndexerConfig):
    """云器 Lakehouse Volume 索引器配置"""

    index_volume_type: str  # Volume 类型: 'user', 'table', 'named'
    index_volume_name: Optional[str] = None  # Volume 名称
    index_remote_path: Optional[str] = None  # 远程路径
    index_regexp: Optional[str] = None  # 正则表达式过滤

    @property
    def volume(self) -> str:
        """构建完整的 volume 标识符"""
```

**Volume 类型说明：**

- `user`: 用户个人 Volume，不需要 index_volume_name
- `table`: 表关联 Volume，需要指定表名作为 index_volume_name
- `named`: 命名 Volume，需要指定卷名作为 index_volume_name

#### ClickzettaVolumeIndexer

Volume 文件索引器。

```python
class ClickzettaVolumeIndexer(FsspecIndexer):
    """云器 Lakehouse Volume 文件索引器"""

    def list_files(self) -> List[Dict[str, Any]]:
        """
        列举 Volume 中的文件

        Returns:
            List[Dict]: 文件信息列表，包含 name, path, size, last_modified 等字段
        """

    def get_file_info(self) -> List[Dict[str, Any]]:
        """获取文件信息，list_files 的别名"""
```

#### ClickzettaVolumeDownloaderConfig

Volume 下载器配置类。

```python
class ClickzettaVolumeDownloaderConfig(FsspecDownloaderConfig):
    """云器 Lakehouse Volume 下载器配置"""

    download_volume_type: Optional[str] = None  # Volume 类型: 'user', 'table', 'named'
    download_volume_name: Optional[str] = None  # Volume 名称
    download_remote_path: Optional[str] = None  # 远程路径
    remote_url: Optional[str] = None   # 远程 URL
    download_regexp: Optional[str] = None       # 正则表达式过滤

    @property
    def volume(self) -> str:
        """构建完整的volume标识符"""
        # 自动根据 download_volume_type 和 download_volume_name 构建
```

#### ClickzettaVolumeDownloader

Volume 文件下载器，支持智能错误处理和路径修复。

```python
class ClickzettaVolumeDownloader(FsspecDownloader):
    """云器 Lakehouse Volume 文件下载器"""

    def download_file(
        self,
        remote_path: str,
        local_path: str,
        file_info: Optional[Dict] = None
    ) -> None:
        """
        下载单个文件

        Args:
            remote_path: 远程文件路径
            local_path: 本地保存路径
            file_info: 文件信息字典（用于自动推断 volume）

        Raises:
            FileNotFoundError: 文件不存在于 Volume 中
            Exception: 下载过程中发生错误

        注意:
            - 自动处理 ClickZetta 创建目录而非文件的情况
            - 智能检测并处理 XML 错误响应
            - 确保下载路径的正确性
        """

    def run(
        self,
        files: Optional[List[Dict[str, Any]]] = None,
        **kwargs
    ) -> List[Dict[str, Any]]:
        """
        批量下载文件

        Args:
            files: 要下载的文件列表

        Returns:
            List[Dict]: 下载结果列表，包含:
                - remote_path: 远程文件路径
                - local_path: 本地文件路径
                - status: 'success' 或 'failed'
                - error: 错误信息（如果失败）
        """
```

#### ClickzettaVolumeUploaderConfig

Volume 上传器配置类。

```python
class ClickzettaVolumeUploaderConfig(FsspecUploaderConfig):
    """云器 Lakehouse Volume 上传器配置"""

    volume_type: Optional[str] = None  # Volume 类型: 'user', 'table', 'named'
    volume_name: Optional[str] = None  # Volume 名称
    remote_path: Optional[str] = None  # 远程路径
    remote_url: Optional[str] = None   # 远程 URL
    regexp: Optional[str] = None       # 正则表达式过滤

    def __init__(self, **data):
        """初始化配置，自动构建 remote_url"""
        # 如果未提供 remote_url，会根据 volume_type、volume_name 和 remote_path 自动构建

    @property
    def volume(self) -> str:
        """构建完整的volume标识符"""
        # 自动根据 volume_type 和 volume_name 构建
```

#### ClickzettaVolumeUploader

Volume 文件上传器。

```python
class ClickzettaVolumeUploader(FsspecUploader):
    """云器 Lakehouse Volume 文件上传器"""

    def upload_file(
        self,
        local_path: str,
        remote_path: Optional[str] = None
    ) -> None:
        """
        上传单个文件

        Args:
            local_path: 本地文件路径
            remote_path: 远程保存路径
        """
```

#### ClickzettaVolumeDeleterConfig

Volume 删除器配置类。

```python
class ClickzettaVolumeDeleterConfig:
    """云器 Lakehouse Volume 删除器配置"""

    delete_volume_type: Optional[str] = None  # Volume 类型: 'user', 'table', 'named'
    delete_volume_name: Optional[str] = None  # Volume 名称

    @property
    def volume(self) -> str:
        """构建完整的volume标识符"""
        # 自动根据 delete_volume_type 和 delete_volume_name 构建
```

#### ClickzettaVolumeDeleter

Volume 文件删除器，支持彻底删除文件。

```python
class ClickzettaVolumeDeleter:
    """云器 Lakehouse Volume 文件删除器"""

    def delete_file(self, file_path: str) -> bool:
        """
        删除指定文件

        Args:
            file_path: 要删除的文件路径

        Returns:
            bool: 删除是否成功

        注意:
            - 删除操作是永久性的，无法恢复
            - 删除后文件将从索引中消失，无法再被下载或访问
            - 支持删除各种路径格式的文件
        """

    def delete_directory(self, directory_path: str) -> bool:
        """删除指定目录及其所有内容"""

    def delete_all(self) -> bool:
        """删除 Volume 中的所有内容"""
```

### Volume 连接器使用示例

#### 完整的 Volume 操作流程

以下示例展示了如何正确使用修复后的 Volume 连接器：

```python
import tempfile
from pathlib import Path
from unstructured_ingest.processes.connectors.fsspec.clickzetta_volume import *

# 1. 创建连接配置
config = ClickzettaVolumeConnectionConfig(
    access_config=ClickzettaVolumeAccessConfig()
)

# 2. 索引操作 - 列出文件
indexer = ClickzettaVolumeIndexer(
    connection_config=config,
    index_config=ClickzettaVolumeIndexerConfig(
        index_volume_type="user",  # 或 "table", "named"
        index_volume_name=None,    # table/named volume 需要指定名称
        index_remote_path="docs/", # 可选：指定子目录
        index_regexp=r".*\.pdf$"   # 可选：正则过滤
    )
)
files = indexer.list_files()

# 3. 下载操作 - 智能错误处理
with tempfile.TemporaryDirectory() as temp_dir:
    downloader = ClickzettaVolumeDownloader(
        connection_config=config,
        download_config=ClickzettaVolumeDownloaderConfig(
            download_volume_type="user",
            download_dir=temp_dir,
            # 其他字段会自动继承或推断
        )
    )
    results = downloader.run(files[:3])  # 下载前3个文件

    for result in results:
        if result["status"] == "success":
            print(f"下载成功: {result['local_path']}")
        else:
            print(f"下载失败: {result['error']}")

# 4. 上传操作 - 自动构建 remote_url
test_file = Path("test.txt")
test_file.write_text("测试内容")

uploader = ClickzettaVolumeUploader(
    connection_config=config,
    upload_config=ClickzettaVolumeUploaderConfig(
        volume_type="user",
        remote_path="uploaded_test.txt"
        # remote_url 会自动构建
    )
)
uploader.upload_file(str(test_file), "uploaded_test.txt")

# 5. 删除操作 - 彻底删除验证
deleter = ClickzettaVolumeDeleter(
    connection_config=config,
    deleter_config=ClickzettaVolumeDeleterConfig(
        delete_volume_type="user"
    )
)
success = deleter.delete_file("uploaded_test.txt")
print(f"删除结果: {success}")

# 6. 验证删除效果
files_after = indexer.list_files()
remaining = [f for f in files_after if f["name"] == "uploaded_test.txt"]
print(f"删除后剩余文件: {len(remaining)}")  # 应该为 0
```

#### 关键改进说明

1. **配置类字段完整性**: 所有配置类现在包含必要的字段
2. **路径处理修复**: 修复了字符串和 Path 对象拼接问题
3. **智能错误处理**: 自动检测和处理 XML 错误响应
4. **目录vs文件修复**: 正确处理 ClickZetta 创建目录的情况
5. **删除功能验证**: 确保删除操作的完整性和正确性

### DashScope 嵌入服务

#### DashScopeEmbeddingConfig

DashScope 嵌入配置类。

```python
class DashScopeEmbeddingConfig(EmbeddingConfig):
    """DashScope 嵌入服务配置"""

    model_name: str = "text-embedding-v3"  # 模型名称
    api_key: Optional[str] = None  # API 密钥
    batch_size: int = 25  # 批处理大小
    max_retries: int = 3  # 最大重试次数
    retry_delay: float = 1.0  # 重试延迟（秒）
    text_field: str = "content"  # 文本字段名
    dimensions: Optional[int] = None  # 向量维度
```

**支持的模型：**

| 模型名 | 维度 | 最大输入长度 |
|--------|------|-------------|
| text-embedding-v1 | 1536 | 2048 tokens |
| text-embedding-v2 | 1536 | 2048 tokens |
| text-embedding-v3 | 1024 | 8192 tokens |
| text-embedding-v4 | 1024 | 8192 tokens |

#### DashScopeEmbedder

DashScope 嵌入器实现类。

```python
class DashScopeEmbedder(BaseEmbedder):
    """DashScope 嵌入器"""

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        为文档列表生成嵌入向量

        Args:
            texts: 要嵌入的文本列表

        Returns:
            List[List[float]]: 嵌入向量列表
        """

    def embed_query(self, text: str) -> List[float]:
        """
        为查询文本生成嵌入向量

        Args:
            text: 查询文本

        Returns:
            List[float]: 嵌入向量
        """

    async def embed_documents_async(self, texts: List[str]) -> List[List[float]]:
        """异步版本的文档嵌入"""

    async def embed_query_async(self, text: str) -> List[float]:
        """异步版本的查询嵌入"""
```

## 工具函数

### Volume 工具函数

#### build_remote_url

```python
def build_remote_url(volume: str, remote_path: Optional[str] = None) -> str:
    """
    构建云器 Lakehouse Volume 协议的远程 URL

    Args:
        volume: Volume 标识符
        remote_path: 远程路径

    Returns:
        str: 完整的 Volume URL

    Examples:
        build_remote_url("user", "docs/file.txt") -> "volume:user://~/docs/file.txt"
        build_remote_url("table_docs", "images/") -> "volume:table://docs/images/"
        build_remote_url("shared_volume", "data/") -> "volume://shared_volume/data/"
    """
```

#### build_sql

```python
def build_sql(
    action: str,
    volume: str,
    file_path: Optional[str] = None,
    is_table: bool = False,
    is_user: bool = False,
    regexp: Optional[str] = None
) -> str:
    """
    构建云器 Lakehouse Volume 操作的 SQL 语句

    Args:
        action: 操作类型 ('list', 'get', 'put', 'remove_file', 'remove_dir', 'remove_all')
        volume: Volume 标识符
        file_path: 文件路径
        is_table: 是否为 Table Volume
        is_user: 是否为 User Volume
        regexp: 正则表达式过滤（仅用于 list 操作）

    Returns:
        str: SQL 语句

    Examples:
        build_sql("list", "user", "docs/", is_user=True)
        -> "LIST USER VOLUME SUBDIRECTORY 'docs/'"

        build_sql("get", "table_docs", "file.txt", is_table=True)
        -> "GET TABLE VOLUME docs FILE 'file.txt' TO '{local_path}'"
    """
```

#### get_env_multi

```python
def get_env_multi(key: str) -> str:
    """
    多前缀环境变量查找

    支持的前缀顺序：CLICKZETTA_, CZ_, cz_, 无前缀
    支持大小写变体

    Args:
        key: 环境变量基础名称

    Returns:
        str: 找到的环境变量值，未找到返回 None

    Examples:
        # 查找顺序：CLICKZETTA_USERNAME, CZ_USERNAME, cz_username, USERNAME,
        #         CLICKZETTA_username, CZ_username, cz_username, username
        get_env_multi("username")
    """
```

### SQL 工具函数

#### 数据验证函数

```python
def validate_vector_dimension(vector: List[float], expected_dim: int) -> bool:
    """验证向量维度是否正确"""

def validate_batch_data(data: List[Dict], required_fields: List[str]) -> bool:
    """验证批次数据是否包含必需字段"""

def sanitize_table_name(table_name: str) -> str:
    """清理表名，确保符合 SQL 命名规范"""
```

## 异常类

### UserAuthError

```python
class UserAuthError(Exception):
    """用户认证错误"""
    # 当云器 Lakehouse 连接认证失败时抛出
```

### UserError

```python
class UserError(Exception):
    """用户操作错误"""
    # 当用户配置或操作有误时抛出
```

## 配置示例

### 完整的环境变量配置

```bash
# 云器 Lakehouse 连接配置
export CLICKZETTA_SERVICE="https://your-service.clickzetta.com"
export CLICKZETTA_USERNAME="your_username"
export CLICKZETTA_PASSWORD="your_password"
export CLICKZETTA_WORKSPACE="your_workspace"
export CLICKZETTA_SCHEMA="your_schema"
export CLICKZETTA_INSTANCE="your_instance"
export CLICKZETTA_VCLUSTER="your_vcluster"

# DashScope 配置
export DASHSCOPE_API_KEY="your_dashscope_api_key"

# 可选的性能配置
export CLICKZETTA_POOL_SIZE="10"
export DASHSCOPE_RATE_LIMIT="100"
export BATCH_SIZE="1000"
export MAX_WORKERS="4"

# 日志配置
export UNSTRUCTURED_LOG_LEVEL="INFO"
export ENABLE_METRICS="true"
```

### Python 配置示例

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class ETLConfig:
    """完整的 ETL 配置类"""

    # 云器 Lakehouse SQL 配置
    clickzetta_service: str
    clickzetta_username: str
    clickzetta_password: str
    clickzetta_workspace: str
    clickzetta_schema: str
    clickzetta_instance: str
    clickzetta_vcluster: str

    # DashScope 配置
    dashscope_api_key: str
    dashscope_model: str = "text-embedding-v3"

    # 处理配置
    sql_batch_size: int = 1000
    volume_batch_size: int = 100
    embed_batch_size: int = 25

    # Volume 配置
    default_volume_type: str = "named"
    default_volume_name: Optional[str] = None

    @classmethod
    def from_env(cls) -> "ETLConfig":
        """从环境变量创建配置"""
        import os
        return cls(
            clickzetta_service=os.getenv("CLICKZETTA_SERVICE"),
            clickzetta_username=os.getenv("CLICKZETTA_USERNAME"),
            clickzetta_password=os.getenv("CLICKZETTA_PASSWORD"),
            clickzetta_workspace=os.getenv("CLICKZETTA_WORKSPACE"),
            clickzetta_schema=os.getenv("CLICKZETTA_SCHEMA"),
            clickzetta_instance=os.getenv("CLICKZETTA_INSTANCE"),
            clickzetta_vcluster=os.getenv("CLICKZETTA_VCLUSTER"),
            dashscope_api_key=os.getenv("DASHSCOPE_API_KEY"),
            dashscope_model=os.getenv("DASHSCOPE_MODEL", "text-embedding-v3"),
        )
```

## 性能调优参数

### 批处理大小建议

```python
# 不同场景的推荐批处理大小
PERFORMANCE_CONFIGS = {
    "small_dataset": {
        "sql_batch_size": 500,
        "volume_batch_size": 50,
        "embed_batch_size": 10,
    },
    "medium_dataset": {
        "sql_batch_size": 1000,
        "volume_batch_size": 100,
        "embed_batch_size": 25,
    },
    "large_dataset": {
        "sql_batch_size": 5000,
        "volume_batch_size": 500,
        "embed_batch_size": 50,
    },
    "memory_constrained": {
        "sql_batch_size": 100,
        "volume_batch_size": 20,
        "embed_batch_size": 5,
    }
}
```

### 连接池配置

```python
# 云器 Lakehouse 连接池配置
POOL_CONFIG = {
    "max_connections": 10,
    "min_connections": 2,
    "connection_timeout": 30,
    "idle_timeout": 300,
    "retry_attempts": 3,
    "retry_delay": 1.0,
}
```

## 测试工具

### 连接测试

```python
def test_clickzetta_connection(config: ClickzettaConnectionConfig) -> bool:
    """测试云器 Lakehouse 连接是否正常"""
    try:
        with config.get_session() as session:
            result = session.sql("SELECT 1 as test").collect()
            return len(result) == 1
    except Exception:
        return False

def test_dashscope_connection(config: DashScopeEmbeddingConfig) -> bool:
    """测试 DashScope 连接是否正常"""
    try:
        embeddings = config.embed_documents(["测试"])
        return len(embeddings) == 1 and len(embeddings[0]) > 0
    except Exception:
        return False
```

### 数据验证工具

```python
def validate_etl_pipeline(
    source_config: Dict,
    destination_config: Dict,
    sample_size: int = 100
) -> Dict[str, bool]:
    """验证完整的 ETL 管道"""
    results = {
        "source_connection": False,
        "destination_connection": False,
        "data_extraction": False,
        "embedding_generation": False,
        "data_upload": False
    }

    # 实现各项验证逻辑...

    return results
```



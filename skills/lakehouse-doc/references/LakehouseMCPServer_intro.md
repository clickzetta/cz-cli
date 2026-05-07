# Lakehouse MCP Server 介绍以及快速部署

## 简介：

MCP（Model Context Protocol）Server 是一种标准化的接口协议，允许 AI 助手（如 Claude）与外部系统和工具进行安全、可控的交互。通过 MCP Server，AI 助手可以直接访问和操作各种数据源、执行复杂的数据分析任务，并提供更加智能和高效的服务。

Lakehouse MCP Server 是专为 Lakehouse 平台设计的 MCP 服务器，它将云器 Lakehouse 强大的数据湖仓能力与 AI 助手无缝集成，让用户能够通过自然语言与数据湖仓进行交互。

## 核心特性

* **协议支持**：支持 HTTP (Streamable)、SSE、Stdio 三种传输协议
* **标准兼容**：完全遵循 MCP 官方规范，提供标准 `/mcp` 端点
* **广泛兼容**：支持 Claude Desktop、Dify、n8n、Cursor 等主流平台

## 部署环境要求

### 系统要求

* **操作系统**：MacOS、Windows、Linux
* **Docker**：20.10+ 版本
* **内存**：最低 2GB，推荐 8GB
* **CPU**：最低 2 核，推荐 4 核
* **存储**：最低 10GB 可用空间

## 快速开始

本示例介绍采用 **HTTP (Streamable**) 协议方式部署（推荐），同时 Claude Desktop (MCP 客户端) 和 MCP 服务器都运行在同一台本地计算机（localhost）上（该架构同样支持分布式部署，即客户端、服务器和 Lakehouse 平台可以分别位于不同的远程主机上）。

![](.topwrite/assets/mcp_arch.jpeg =586)

### 步骤0：MCP Server 端配置准备

Docker 环境准备：访问 <https://www.docker.com/products/docker-desktop/> 下载 Docker Desktop for Mac。

1. 验证安装 Docker Desktop （MacOS 环境）保证 Docker 版本20.10+

```Bash
docker --version 
```

2. 配置 Docker Desktop：

* 分配至少 4GB 内存给 Docker
* 启用文件共享功能

### 步骤1：MCP Server 端：拉取最新云器的 MCP Server 镜像

```Bash
docker pull czqiliang/mcp-clickzetta-server:latest
```

### 步骤2：MCP Server 端：创建工作目录（如果不存在）

* macOS:

  ```Bash
  mkdir -p ~/.clickzetta/lakehouse_connection
  ```

* Windows PowerShell:

  ```PowerShell
  New-Item -ItemType Directory -Path "$env:USERPROFILE\.clickzetta/lakehouse_connection" -Force
  ```

在上述路径下，新建名称为 `connections.json` 的配置文件并添加 Lakehouse 实例的连接信息，配置模板如下（如果连接两个 Lakehouse 实例，用逗号分隔）：

```JSON
{
  "connections": [
    {
      "is_default": true,
      "service": "cn-shanghai-alicloud.api.clickzetta.com",
      "username": "__your_name__",
      "password": "__your_password__",
      "instance": "__your_instanceid__",
      "workspace": "__your_workspacename__",
      "schema": "public",
      "vcluster": "default_ap",
      "description": "UAT environment for testing",
      "hints": {
        "sdk.job.timeout": 300,
        "query_tag": "mcp_uat"
      },
      "name": "Shanghai production env",
      "is_active": false,
      "last_test_time": "2025-06-30T19:55:51.839166",
      "last_test_result": "success"
    }
  ]
}
```

参数说明：

| 参数名                   | 说明                                                                        | 示例值                                                                                                                                                                                                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| is\_default           | 是否为默认连接配置                                                                 | true                                                                                                                                                                                                                                                                                                                                    |
| service               | 服务端点地址请参考[文档](https://www.yunqi.tech/documents/Supported_Cloud_Platforms) | **上海阿里云**：cn-shanghai-alicloud.api.clickzetta.com&#xA;**北京腾讯云**：ap-beijing-tencentcloud.api.clickzetta.com&#xA;**北京 AWS** ：cn-north-1-aws.api.clickzetta.com&#xA;**广州腾讯云**：ap-guangzhou-tencentcloud.api.clickzetta.com&#xA;**新加坡阿里云**：ap-southeast-1-alicloud.api.singdata.com&#xA;**新加坡** **AWS**：ap-southeast-1-aws.api.singdata.com |
| username              | 用户名，用于身份验证                                                                | "your\_name"                                                                                                                                                                                                                                                                                                                            |
| password              | 密码，用于身份验证                                                                 | "your\_password"                                                                                                                                                                                                                                                                                                                        |
| instance              | 实例ID，标识特定的Lakehouse实例                                                     | "your\_instanceid"                                                                                                                                                                                                                                                                                                                      |
| workspace             | 工作空间名称，用于数据隔离和组织                                                          | "your\_workspacename"                                                                                                                                                                                                                                                                                                                   |
| schema                | 数据库模式名称                                                                   | "public"                                                                                                                                                                                                                                                                                                                                |
| vcluster              | 虚拟集群名称，用于计算资源管理                                                           | "default\_ap"                                                                                                                                                                                                                                                                                                                           |
| description           | 连接配置的描述信息                                                                 | "UAT environment for testing"                                                                                                                                                                                                                                                                                                           |
| hints                 | 性能优化和标识配置对象                                                               | {...}                                                                                                                                                                                                                                                                                                                                   |
| hints.sdk.job.timeout | SDK作业超时时间（秒）                                                              | 300                                                                                                                                                                                                                                                                                                                                     |
| hints.query\_tag      | 查询标签，用于查询追踪和标识                                                            | "mcp\_uat"                                                                                                                                                                                                                                                                                                                              |
| name                  | 连接配置的名称标识                                                                 | "Shanghai production env"                                                                                                                                                                                                                                                                                                               |
| is\_active            | 连接是否处于活跃状态                                                                | false                                                                                                                                                                                                                                                                                                                                   |
| last\_test\_time      | 最后一次连接测试的时间戳（ISO格式）                                                       | "2025-06-30T19:55:51.839166"                                                                                                                                                                                                                                                                                                            |
| last\_test\_result    | 最后一次连接测试的结果状态                                                             | "success"                                                                                                                                                                                                                                                                                                                               |

### 步骤3：MCP Server 端：启动 MCP Server 镜像

创建 `docker-compose.yml` 文件，拷贝内容到文件中（文件内容详见附录）

在包含该文件的目录下打开终端或命令行，并执行以下命令。

```SQL
docker compose up -d
```

预期输出：

```
bash-3.2$ docker compose up -d
[+] Running 4/4
 ✔ Network mcp_docker_clickzetta-net  Created       0.0s 
   ✔ Container clickzetta-sse           Started       0.2s 
   ✔ Container clickzetta-http          Started       0.2s 
   ✔ Container clickzetta-webui         Started       0.2s
```

校验状态，使用 `docker compose ps --format "table {{.Name}}\t{{.Service}}\t{{.Status}}"` 命令，预期输出如下(忽略 `WARNING` 信息)：

```
bash-3.2$ docker compose ps --format "table {{.Name}}\t{{.Service}}\t{{.Status}}"

NAME               SERVICE            STATUS
clickzetta-http    clickzetta-http    Up 5 hours (unhealthy)
clickzetta-sse     clickzetta-sse     Up 5 hours (unhealthy)
clickzetta-webui   clickzetta-webui   Up 5 hours (unhealthy)
```

> 如果需要关闭，请在包含`docker-compose.yml`文件的目录下执行：`docker compose down`

### 步骤4：配置 Claude Desktop

本示例选择的 MCP 客户端工具是 Claude Desktop，主机与 MCP Server 端位于同一台主机

找到并打开 Claude Desktop 配置文件：

**macOS 操作步骤**：

* 打开 Finder
* 按 `Cmd+Shift+G`
* 粘贴路径：`~/Library/Application Support/Claude`
* 双击打开 `claude_desktop_config.json`（用文本编辑器）

**Windows 操作步骤**：

* 按 `Win+R` 打开运行对话框
* 输入 `%APPDATA%\Claude` 并回车
* 右键点击 `claude_desktop_config.json`
* 选择"编辑"或"用记事本打开"

2\. 将以下内容复制到配置文件（替换原有内容或添加到 `mcpServers` 中）：

请输入 MCP Server 的地址：如果服务器与客户端运行在同一台机器上，请填写 `localhost`；否则，请填写服务器的 IP 地址。

```JSON
{
  "mcpServers": {
    "clickzetta-http": {
      "command": "npx", 
      "args": [
        "-y", "mcp-remote",
        "http://<YOUR_SERVER_IP>:8002/mcp",
        "--allow-http",
        "--transport", "http"
      ]
    }
  }
}
```

**配置完成**！

^

另外：Claude Desktop 支持通过多种方式连接后端的 MCP Server，以适应不同的部署环境和性能需求。上面的示例介绍了 **HTTP (Streamable**) 协议连接方式，如果想利用 **SSE** 或者 **STDIO** 协议连接，配置也很简单：

**SSE 连接方式（远程服务**）

SSE (Server-Sent Events) 是一种基于 HTTP 的长连接技术，允许服务器向客户端单向推送消息。相比于传统的轮询方式，SSE 能够以更低的延迟实现实时通信。

* **适用场景**：需要从服务器实时接收数据流或更新通知的场景。
* **Docker Server 配置参考**：此方式对应启动容器中的 `clickzetta-sse` 的服务，该服务在 `8003` 端口上提供服务。
* **配置示例**：
  在 Claude Desktop 的 `claude_desktop_config.json` 配置文件中更新如下信息，连接到远程 SSE 端点。

```JSON

{
  "mcpServers": {
    "clickzetta-remote-sse": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "http://localhost:8003/sse",
        "--allow-http",
        "--transport", "sse"
      ]
    }
  }
}
```

&#x20;**说明**：

* 请将 `<YOUR_SERVER_IP>` 替换为 MCP Server 实际的 IP 地址或域名。
* 目标端口为 `8003`，端点路径为 `/sse`。
* `--transport sse` 参数指明了使用 SSE 通信协议。

***

**STDIO 连接方式（本地进程**）

此方式主要用于本地开发和调试。Claude Desktop 会将 MCP Server 作为一个子进程直接在本地启动，并通过标准输入/输出（STDIO）进行通信。这种方式延迟最低，但不适用于远程连接。

* **适用场景**：本地开发、单机部署。
* **Docker Server 配置参考**：此方式对应启动容器中的 `clickzetta-stdio` 的服务，该容器镜像会随着 Claude Desktop 的开启和关闭，自动操作容器镜像拉起和停止。
* **配置示例**：在 Claude Desktop 的 `claude_desktop_config.json` 配置文件中更新如下信息，直接指定启动本地 Server 的命令。

**注意**：

1. 配置文件中 `-v `后的路径中 `USERNAME `**请根据系统的实际路径进行修改**。
2. 请使用 `docker compose down `关闭创建的相关容器，因为此种方式下，Claude Desktop 会随着自身的开启和关闭，自动操作容器镜像拉起和停止。

```json
{
  "mcpServers": {
    "clickzetta-stdio": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--stop-timeout", "60",
        "-p", "8502:8501",
        "-v", "/Users/derekmeng/.clickzetta:/app/.clickzetta",
        "czqiliang/mcp-clickzetta-server:latest"
      ]
    }
  }
}
```

**说明**：

* `command` 和 `args` 直接定义了如何在本地启动 MCP Server。
* 无需指定 IP 地址和端口。
* `--transport stdio` 参数指明了使用 STDIO 通信协议。

## 开始使用：

### 部署验证

1\. 打开 Claude Desktop ，在输入框中，发送以下指令：

```Plain
列出所有 Clickzetta Lakehouse 可用的 MCP工具
```

 如果连接成功，您将看到一个包含 50+ 个工具的列表（注意：随着版本更新，工具的具体数量可能会有变化）

2\. **验证 WebUI 界面**

* 在您的浏览器中访问以下地址： `http://localhost:8503, `预期可以展示以下页面：

:-: ![](.topwrite/assets/mcp_web_ui.jpeg =753)

^

如果以上两个步骤都顺利完成，恭喜您，您的应用已成功安装！

### 第二步：配置您的第一个数据源 (Lakehouse)

接下来，让我们配置一个 Lakehouse 连接，以便 Claude 可以访问您的数据。

1. **打开连接管理器**

   访问 WebUI 界面 `http://localhost:8503`，然后在左侧菜单中选择「**连接管理**」。

2. **添加并填写连接信息**

   点击「**添加新连接**」按钮，并根据提示准确填写您的 Lakehouse 连接信息（如主机、端口、凭证等）

:-: ![](.topwrite/assets/mcp_webui_2.jpeg =765)

***

**测试并保存**

1. 填写完毕后，点击「**测试连接**」按钮，确保所有配置信息无误且网络通畅。
2. 测试通过后，点击「**保存**」完成配置。

### 第三步：开始您的第一个查询

现在一切准备就绪！您可以开始与您的数据进行交互了。尝试在 **Claude Desktop** 中提问：

> "帮我看下有哪些 Lakehouse 实例"

### 高级配置：配置云器产品文档知识库

这个步骤会将云器 Lakehouse 产品知识库表集成进来，构建一个智能问答知识库。配置完成后，您将能够在 MCP Client（如 Claude Desktop）中，通过自然语言提问的方式，快速获得关于 Lakehouse 操作的官方指导和答案

该功能的核心是利用**嵌入服务 (Embedding**) 和**向量搜索 (Vector Search**) 技术，将非结构化的文档转化为可供机器理解和检索的知识库。

#### **第一步：配置嵌入服务**

此步骤的目的是告诉 MCP 系统如何将用户的“问题”也转换成向量，以便在知识库中进行匹配。

1. 在 MCP Server 管理界面，从左侧导航栏进入「**系统配置**」。

2. 在主配置区，选择 「**嵌入服务**」 标签页。

3. 找到并填写 **DashScope 配置**（默认）部分：

   * **API Key**：粘贴您的阿里云百炼平台的 API 密钥。这是调用模型的身份凭证，请妥善保管。
   * **向量维度 (Vector Dimension**)：输入您选择的嵌入模型所输出的向量维度。**此值必须与知识库文档向量化时使用的维度完全一致**。例如，截图中 `text-embedding-v4` 模型的维度是 `1024`。
   * **嵌入模型 (Embedding Model**)：选择或填写用于将文本转换为向量的模型名称，例如 `text-embedding-v4`。
   * **最大文本长度 (Max Text Length**)：设置模型一次可以处理的文本单元（Token）的最大数量。如果问题过长，超出部分将被忽略。![](.topwrite/assets/MCP_config_1.jpeg)

4. 点击 **保存嵌入服务配置** 按钮。

#### **第二步：配置向量搜索**

此步骤的目的是告诉 MCP 系统去哪里、以及如何搜索已经存储好的文档知识库。

1. 在 **系统配置** 页面，切换到 「**向量搜索**」 标签页。

2. 填写 **向量表配置** 部分：

   * **向量表名称 (Vector Table Name**)：准确填写存储了文档向量的完整表名。格式通常为 `数据库名.模式名.表名`，例如 `clickzetta_sample_data.clickzetta_doc.kb_dashscope_clickzetta_elements`。
   * **嵌入列 (Embedding Column**)：填写该表中用于存储**文本向量**的列名，例如 `embeddings`。
   * **内容列 (Content Column**)：填写该表中用于存储**原始文本内容**的列名，例如 `text`。当系统找到相关答案时，这里的内容会作为主要参考。
   * **其他列 (Other Columns**)：可选。填写您希望一并检索出的元数据列，如 `file_directory`, `filename`，这有助于用户追溯信息的原始出处。

3. 配置 **搜索参数**：保持默认即可，如果想进行修改，请参考下面的说明

   * **距离阈值 (Distance Threshold**)：设置一个相似度匹配的严格程度。系统会计算问题向量与文档向量之间的“距离”，只有距离小于此值的文档才会被视为相关。**值越小，代表匹配要求越严格**。通常建议从 `0.80` 开始尝试。
   * **返回结果数 (Number of Results to Return**)：定义单次查询从数据库中检索出的最相关文档的数量。例如，设置为 `5` 表示每次找出 5 个最相关的文档片段。
   * **启用重排序 (Enable Reranking**)：勾选此项后，系统会对初步检索出的结果进行二次智能排序，以提高最准确答案出现在最前面的概率。![](.topwrite/assets/MCP_Vector_2.jpeg)

4. 点击 **保存向量搜索配置** 按钮。

## 其他典型使用场景

请参考公众号文章：[MCP Server 如何助力 Lakehouse 实现 AI 驱动的 6 大数据应用场景](https://mp.weixin.qq.com/s/6TE2RvCesgqYJzVcnAqHew)

我们期待与您一起探索 AI 驱动的数据分析新时代！

^

## 附录：

创建 `docker-compose.yml` 文件内容：

```
version: '3.8'
services:
  # HTTP协议服务
  clickzetta-http:
    image: czqiliang/mcp-clickzetta-server:latest
    container_name: clickzetta-http
    restart: unless-stopped
    ports:
      - "8002:8002"  # HTTP协议端口
    volumes:
      - ~/.clickzetta:/app/.clickzetta  # 配置文件挂载
    # 完全绕过uv，直接使用虚拟环境Python
    entrypoint: []
    command: ["/app/.venv/bin/python", "-m", "mcp_clickzetta_server","--transport","http", "--host", "0.0.0.0", "--port", "8002"]
    environment:
      - LOG_LEVEL=INFO
      - PYTHONUNBUFFERED=1
      - TZ=Asia/Shanghai  # 时区设置
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: '4'
        reservations:
          memory: 512M
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-s", "http://localhost:8002/mcp"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s  # 增加到60秒，给HTTP预热5秒 + FastMCP启动时间
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"
    networks:
      - clickzetta-net
  # SSE协议服务
  clickzetta-sse:
    image: czqiliang/mcp-clickzetta-server:latest
    container_name: clickzetta-sse
    restart: unless-stopped
    ports:
      - "8003:8003"  # SSE协议端口
    volumes:
      - ~/.clickzetta:/app/.clickzetta  # 配置文件挂载
    # 完全绕过uv，直接使用虚拟环境Python
    entrypoint: []
    command: ["/app/.venv/bin/python", "-m", "mcp_clickzetta_server","--transport","sse", "--host", "0.0.0.0", "--port", "8003"]
    environment:
      - LOG_LEVEL=INFO
      - PYTHONUNBUFFERED=1
      - TZ=Asia/Shanghai  # 时区设置
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: '4'
        reservations:
          memory: 512M
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-s", "http://localhost:8003/sse"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 120s  # 增加到120秒，给SSE更多启动时间
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"
    networks:
      - clickzetta-net
  
  # WebUI服务
  clickzetta-webui:
    image: czqiliang/mcp-clickzetta-server:latest
    container_name: clickzetta-webui
    restart: unless-stopped
    ports:
      - "8503:8501"  # WebUI端口
    volumes:
      - ~/.clickzetta:/app/.clickzetta  # 配置文件挂载
    # 直接启动Streamlit WebUI，绕过所有包装脚本
    entrypoint: []
    command: ["/bin/bash", "-c", "cd /app/streamlit_webui && /app/.venv/bin/python -m streamlit run app.py --server.port=8501 --server.address=0.0.0.0 --server.headless=true --browser.gatherUsageStats=false"]
    environment:
      - LOG_LEVEL=INFO
      - PYTHONUNBUFFERED=1
      - TZ=Asia/Shanghai  # 时区设置
      - PYTHONPATH=/app/src:/app/streamlit_webui/src
    working_dir: /app/streamlit_webui
    deploy:
      resources:
        limits:
          memory: 8G
          cpus: '4'
        reservations:
          memory: 512M
          cpus: '0.5'
    healthcheck:
      test: ["CMD", "curl", "-s", "http://localhost:8501"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "3"
    networks:
      - clickzetta-net

networks:
  clickzetta-net:
    driver: bridge
```

^

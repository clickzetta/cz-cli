# 与 N8N 集成实现统一 AI 工作流的安装与使用指南

[N8N ](https://n8n.io/)是一个工作流自动化平台，它为技术团队提供了代码般的灵活性和无代码般的速度。N8N 拥有 400 多个集成、原生 AI 功能以及公平代码许可证，让您能够构建强大的自动化流程，同时完全掌控您的数据和部署。

云器 Lakehouse 实现了和 N8N 的集成，本文是完整的安装部署和日常使用指南，帮助您快速上手云器 Lakehouse 与 N8N 集成的安装与使用！

除了作为普通的 N8N 节点外，云器 Lakehouse 扩展还提供数据比对方面的功能，包括：

* **多数据库支持**：除了支持云器 Lakehouse 外，本扩展方案还支持阿里云 MaxCompute、华为云 DLI、PostgreSQL、ClickZetta、MySQL、SQLite、Oracle、Microsoft SQL Server 等。
* **数据比对**：表数据比对、模式比对、实时差异检测。
* **工作流自动化**：基于 N8N 的可视化工作流。
* **参数自动填充**：智能地从上游节点获取连接信息和表列表。
* **表达式引用**：支持 N8N 表达式语法引用上游数据。

:-: ![](.topwrite/assets/image_1756880876090.png =747)

^

以下是扩展节点的说明：

* 支持云器 Lakehouse 的 N8N 节点：

:-: ![](.topwrite/assets/image_1756881498726.png =339)

^

* 支持更多类型数据库的 N8N 节点：

:-: ![](.topwrite/assets/image_1756881587120.png =285)

^

* 数据比对节点（异步执行）：

:-: ![](.topwrite/assets/image_1756881686613.png =301)

^

* 获取数据比对结果节点：

:-: ![](.topwrite/assets/image_1756881921377.png =333)

## 📋 前提条件

* 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 或 Docker Engine

* 至少 8GB 内存

* 可用端口：

  * 80（Nginx 统一入口）
  * 5678（N8N，可通过 .env 修改）
  * 8000（API，可通过 .env 修改）
  * 3000（Grafana，可通过 .env 修改）
  * 9090（Prometheus，可通过 .env 修改）
  * 5432（PostgreSQL，可通过 .env 修改）

## 🎯 安装部署

### 1️⃣ 下载部署包

下载 `data-diff-n8n-deploy-latest.zip` 并解压到任意目录：

```bash
# 使用 curl 下载（推荐）
curl -L -O https://github.com/yunqiqiliang/clickzetta_quickstart/raw/main/datadiff_n8n_clickzetta/data-diff-n8n-deploy-latest.zip

# 或使用 wget 下载（覆盖已有文件）
wget -O data-diff-n8n-deploy-latest.zip https://github.com/yunqiqiliang/clickzetta_quickstart/raw/main/datadiff_n8n_clickzetta/data-diff-n8n-deploy-latest.zip

# 解压部署包（覆盖模式）
unzip -o data-diff-n8n-deploy-latest.zip
cd data-diff-n8n/

# 如果需要交互式确认每个文件的覆盖
# unzip data-diff-n8n-deploy-latest.zip
```

### 2️⃣ 检查端口（推荐）

在部署前检查所需端口是否可用：

**Windows**:
```cmd
check-ports.bat
```

**macOS/Linux**:
```bash
./check-ports.sh
```

检查脚本会自动检测所有必需端口是否可用。如果发现端口冲突，可以：

1.  停止占用端口的服务
2.  或在运行 `./deploy.sh setup` 后编辑 `.env` 文件修改相应端口

### 3️⃣ 初始化配置

**Windows**:
```cmd
deploy.bat setup
```

**macOS/Linux**:
```bash
./deploy.sh setup
```

此命令会：

* 创建 `.env` 配置文件
* 自动生成安全密码
* 准备部署环境

⚠️ **重要提醒**：

*   初始化完成后，**请立即查看并保存** `.undefined` **文件中的密码**。

*   自动生成的密码包括：

  *   PostgreSQL 数据库密码（POSTGRES_PASSWORD）
  *   N8N 基本认证密码（N8N_BASIC_AUTH_PASSWORD，用户名默认为 admin）
  *   Grafana 管理员密码（GRAFANA_PASSWORD，用户名默认为 admin）

* 请妥善保管这些密码，丢失后将无法恢复

### 4️⃣ 启动服务

#### 首次部署

**Windows**:
```cmd
deploy.bat init
```

**macOS/Linux**:
```bash
./deploy.sh init
```

启动时间取决于是否需要下载镜像：

* **首次启动**：10-20 分钟（需要下载所有 Docker 镜像，约 2GB）
* **后续启动**：2-3 分钟（镜像已在本地）

启动过程中会：

1. 自动拉取所有必需的 Docker 镜像（6个服务）
2. 创建并初始化 PostgreSQL 数据库
3. 配置 Grafana 仪表板
4. 启动所有服务并进行健康检查

#### 日常使用

**Windows**:
```cmd
deploy.bat start
```

**macOS/Linux**:
```bash
./deploy.sh start
```

`start` 命令直接启动所有服务，适合日常使用。

💡 提示：

* 使用 `deploy.sh status` 查看启动进度
* 使用 `deploy.sh logs` 查看服务日志

## 🎉 访问服务

部署完成后，可以通过以下方式访问服务：

| 服务            | 访问地址                                  | 说明                 |
| --------------- | ----------------------------------------- | -------------------- |
| 🏠 主页         | [http://localhost](http://localhost/)               | 系统概览和快速导航     |
| 🔄 N8N 工作流    | <http://localhost/n8n/>            | 创建和管理数据比对工作流 |
| 📊 API 文档     | <http://localhost/api/docs>            | RESTful API 接口文档 |
| 📖 API 参考     | <http://localhost/api/redoc>           | API 参考手册（ReDoc 风格） |
| 📈 Grafana 监控 | <http://localhost/grafana/>            | 数据质量和系统监控仪表板 |
| 🔍 Prometheus   | <http://localhost/prometheus/>           | 指标查询和告警管理      |

:-: ![](.topwrite/assets/image_1756882465416.png =821)

登录凭据请查看 `.env` 文件中的密码。

💡 **提示**：

* 所有服务均通过 **80 端口统一访问**（已自动配置 Nginx 反向代理）。
* 由于配置了子路径，**不支持直接通过服务端口访问**（如 N8N 的 5678 端口）。
* **远程访问**：部署在服务器时，将 `localhost` 替换为服务器 IP 地址（如 `http://172.17.1.220`）。
* **修改端口**：如需修改 80 端口，请编辑 `.env` 文件中的 `HTTP_PORT` 后重启服务。

## 🛠️ 日常操作

### 查看服务状态

```bash
# Windows
deploy.bat status

# macOS/Linux
./deploy.sh status
```

### 查看日志

```bash
# 查看所有服务日志
deploy.bat logs

# 查看特定服务日志
deploy.bat logs n8n
```

### 停止服务

**Windows**:
```cmd
deploy.bat stop
```

**macOS/Linux**:
```bash
./deploy.sh stop
```

### 重启服务

**Windows**:
```cmd
deploy.bat restart
```

**macOS/Linux**:
```bash
./deploy.sh restart
```

### 其他命令

**完全停止（移除容器）**：

```bash
./deploy.sh stop-all
```

**完整重启（包含初始化检查）**：

```bash
./deploy.sh restart-full
```

💡 提示：

* 日常操作使用 `start`、`stop`、`restart` 即可。
* `stop` 只停止容器，`stop-all` 会移除容器。
* `init` 和 `restart-full` 包含完整的初始化检查，适合故障排除。

## 📝 配置说明

编辑 `.env` 文件可以修改：

* **端口配置**：默认通过 80 端口统一访问
* **密码设置**：修改各服务的访问密码
* **资源限制**：调整 API 工作进程数等
* **公共 URL**：配置 N8N 的外部访问地址

示例：

```env
# 修改统一入口端口（默认 80）
HTTP_PORT=8080

# 配置 N8N 公共 URL（用于生成邀请链接等）
N8N_PUBLIC_URL=http://172.17.1.220/n8n

# 修改 API 工作进程数（默认 4）
API_WORKERS=8

# 修改数据库端口（如果需要外部访问）
POSTGRES_PORT=5433
```

## 🔧 诊断工具

### check-env-vars.sh 使用指南

当遇到数据库连接或认证问题时，使用此工具进行诊断：

```bash
./check-env-vars.sh
```

**适用场景**：

* N8N 或 API 服务报告 "password authentication failed"
* 需要验证环境变量是否正确传递给容器
* 检查容器内实际使用的配置值

**功能说明**：

1. 显示 `.env` 文件中的配置
2. 展示 Docker Compose 解析后的环境变量
3. 检查运行中容器的实际环境变量
4. 测试数据库连接是否正常

**示例输出**：

```bash
=== 环境变量检查工具 ===

1. 检查 .env 文件内容:
POSTGRES_PASSWORD 设置: VUEk30jlqj6rd48U

2. Docker Compose 解析后的环境变量:
[显示各服务的环境变量配置]

3. 运行中容器的实际环境变量:
[显示容器内的实际环境变量]

4. 测试数据库连接:
✓ 可以使用 .env 密码连接
```

如果发现密码不匹配，通常需要清理并重新部署：

```bash
./deploy.sh clean
./deploy.sh setup
./deploy.sh init
```

## 🔄 更新部署

当有新版本发布时，可以使用以下步骤更新：

### 保留配置的更新

```bash
# 1. 备份当前配置（推荐）
cp .env .env.backup

# 2. 下载最新版本（覆盖旧文件）
curl -L -O https://github.com/yunqiqiliang/clickzetta_quickstart/raw/main/datadiff_n8n_clickzetta/data-diff-n8n-deploy-latest.zip

# 3. 解压并覆盖（除了 .env 文件）
unzip -o data-diff-n8n-deploy-latest.zip -x "data-diff-n8n/.env"

# 4. 重启服务
./deploy.sh restart
```

### 完全覆盖更新

```bash
# 警告：这会覆盖所有文件，包括配置
unzip -o data-diff-n8n-deploy-latest.zip
```

💡 **提示**：

* `-o` 参数表示自动覆盖所有文件，不询问。
* `-x` 参数可以排除特定文件不被覆盖。
* 建议总是先备份 `.env` 文件，其中包含您的密码配置。

## 🚨 故障排除

### 端口被占用

默认使用 80 端口作为统一入口。如果 80 端口被占用：

1. 编辑 `.env` 文件，修改 `HTTP_PORT`：

   ```env
   HTTP_PORT=8080  # 或其他可用端口
   ```

2. 重启服务：

   ```bash
   ./deploy.sh restart
   ```

3. 访问新端口：

   ```bash
   http://localhost:8080
   ```

### Docker 未运行

确保 Docker Desktop 已启动并正在运行。

### 服务无法访问

1. 使用 `deploy.bat status` 检查服务状态
2. 使用 `deploy.bat logs` 查看错误日志
3. 确保防火墙允许相应端口访问

### 数据库初始化错误

如果看到以下错误：

* `数据库初始化失败：datadiff 数据库不存在`
* `数据库表未正确创建`
* `password authentication failed for user "postgres"`
* `relation "data_diff_results.comparison_summary" does not exist`

**原因**：

1.  PostgreSQL 数据卷保留了旧的配置或密码。
2.  数据库初始化脚本未能执行（PostgreSQL 只在首次创建数据卷时执行 `/docker-entrypoint-initdb.d/` 中的脚本）。

**解决方案**：

```bash
# 完全清理并重新部署./deploy.sh clean./deploy.sh setup./deploy.sh init
```

**说明**：

* PostgreSQL 使用 Docker 卷存储数据，首次启动时会执行 `init-databases.sql`
* 如果数据卷已存在，即使更新了 SQL 文件也不会重新执行
* `clean` 命令会删除数据卷，确保下次启动时重新初始化

**重要**：`clean` 命令会删除所有数据，请确保已备份重要数据。

## 📚 进阶使用

### 创建第一个比对工作流

1. 访问 N8N (<http://localhost/n8n/>)

2. 使用 `.env` 中的凭据登录

   * 用户名：admin（或查看 N8N\_BASIC\_AUTH\_USER）
   * 密码：查看 `.env` 中的 N8N\_BASIC\_AUTH\_PASSWORD

3. 创建新工作流

4. 添加 "Data Comparison Dual Input" 节点

5. 配置源和目标数据库连接

6. 运行工作流查看结果

### 查看监控仪表板

1. 访问 Grafana (<http://localhost/grafana/>)

2. 使用 admin 和 `.env` 中的密码登录

3. 打开预配置的仪表板：

   * **业务指标**：查看数据质量和比对结果
   * **系统监控**：查看性能和资源使用情况

### 使用 API 接口

1. 访问 API 文档 (<http://localhost/api/docs>)

2. 支持的主要接口：

   * `/api/v1/compare/tables` - 比较两个表的数据
   * `/api/v1/compare/schemas/nested` - 比较数据库模式结构
   * `/api/v1/connections/test` - 测试数据库连接
   * `/api/v1/tables/list` - 获取数据库表列表
   * `/api/v1/query/execute` - 执行 SQL 查询
   * `/api/v1/maintenance/db-maintenance` - 数据库维护操作
   * `/api/v1/metrics` - 获取 Prometheus 格式的系统指标

3. 在文档页面可以直接测试 API 调用。

## 🆘 需要帮助？

* 📖 查看项目文档
* 🐛 报告问题
* 💬 联系技术支持

## ⚠️ 安全提示

* 请务必修改 `.env` 文件中的默认密码
* 定期备份数据库数据
* 限制服务的网络访问范围

## 参考

本项目已开源：<https://github.com/yunqiqiliang/data-diff-n8n>

^

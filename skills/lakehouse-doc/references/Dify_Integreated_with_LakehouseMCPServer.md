# Dify中集成Lakehouse MCP Server

Dify 的 Agent 应用中，支持直接集成来自外部 [MCP](https://modelcontextprotocol.io/introduction) 服务器的[工具](https://modelcontextprotocol.io/docs/concepts/tools)。这给Lakehouse与您的Dify AI应用集成提供了新方式。
Lakehouse MCP Server通过这种方式实现和Dify的集成，来自Lakehouse MCP Server的丰富的工具可以在Dify 的 Agent 轻松调起来。

## Dify MCP 服务器管理界面

登录 Dify 后，在左侧导航栏中依次点击 **工具** → **MCP**，即可进入外部 MCP 服务器的管理页面。在这里，你可以统一管理所有为自身应用配置的 MCP 服务器。

## 添加 Lakehouse MCP 服务器

首先你需要部署支持[HTTP协议的Lakehouse MCP Server](LakehouseMCPServer_intro.md)

:-: ![](.topwrite/assets/image_1756885164463.png =815)

点击 **添加 MCP 服务器（HTTP**），即可集成Lakehouse MCP Server工具服务。需要填写如下信息：

* **服务器 URL**：Lakehouse MCP 服务器的 HTTP 接口地址，例如集成 Notion 时为 `http://192.168.1.220:8001/mcp`。
* **名称与图标**：自定义服务器名称，建议选择能清晰体现工具用途的名字。Dify 会自动尝试获取服务器域名的图标，你也可以手动上传。比如：clickzetta-mcp-server-mcp-220
* **服务器标识符**：Dify 用于区分服务器的唯一 ID。规则：小写字母、数字、下划线或连字符，最多 24 个字符。比如clickzetta\_mcp\_mcp\_220

服务器 ID 一旦创建即无法更改。如果更改服务器 ID，所有依赖该服务器工具的 Agent 或 Workflow 都会失效。这一设计对于[应用迁移](https://docs.dify.ai/zh-hans/guides/tools/mcp##application-portability)尤为重要。

添加服务器后，Dify 会自动执行如下操作：

1. **检测可用工具**：自动识别该服务器能提供哪些工具功能。
2. **处理授权流程**：如服务器需要身份验证，则自动发起 OAuth 授权流程。
3. **获取工具定义**：下载各工具的接口定义（schema）。
4. **同步工具列表**：将识别到的工具加入 Agent 或Workflow应用的构建页面。

当 Dify 成功获取到至少一个可用工具后，会在页面中显示该服务器的信息卡片：

:-: ![](.topwrite/assets/image_1756885349165.png =806)

## 管理已连接服务器

点击对应服务器卡片，可进行以下操作：

* **更新工具**：重新从服务器获取最新工具信息，适用于服务方新增或调整功能后更新。

* **重新授权**：点击授权状态，更新服务器的访问权限（如令牌失效需重新授权）。

* **编辑配置**：可修改服务器信息。

更改服务器 URL 会触发重新授权，修改服务器 ID 会让已有应用失效！

:-: ![](.topwrite/assets/image_1756885405845.png =478)

* **移除服务器**：断开服务器连接。此后所有依赖该服务器工具的应用都会报错，直到你重新连接或删除相关工具。

:-: ![](.topwrite/assets/image_1756885449635.png =473)

当服务器配置完成后，其下的工具会出现在应用构建时的工具选择区：

## 设计Agent 应用

:-: ![](.topwrite/assets/image_1756885639345.png =816)

* 在 Agent 配置界面，与内置工具并列显示 MCP 工具。
* 可一键”添加全部”，快速启用该服务器下的所有工具。
* 在Agent节点的指令部分，设置为： 你是clickzetta lakehouse资深产品专家，请帮助用户回答和解决问题。对于clickzetta lakehouse相关的问题，如果没有合适的tool，你需要先通过get\_product\_knowledge这个tool查产品知识库获得知识。作为产品专家，你不能编造任何假设性的产品知识和判断。一切要基于MCP tools的调用的知识和客观结果。

## 发布Agent 应用

:-: ![](.topwrite/assets/image_1756885966336.png =786)

## 访问Agent 应用

发布后，点击在'探索'中打开，在浏览器里访问Agent应用，这里可以按照对话内容调度起来Lakehouse MCP Server对应的tools。

![](.topwrite/assets/image_1756886184934.png)

# N8N中集成Lakehouse MCP Server

N8N 的 Agent 节点支持直接集成来自外部 [MCP](https://modelcontextprotocol.io/introduction) 服务器的[工具](https://modelcontextprotocol.io/docs/concepts/tools)。这为 Lakehouse 与您的 N8N AI 工作流集成提供了新方式。
Lakehouse MCP Server 通过这种方式实现与 N8N 的集成，来自 Lakehouse MCP Server 的丰富工具可以在 N8N 的 Agent 节点中轻松调用。

首先，您需要部署支持 [SSE协议的Lakehouse MCP Server](LakehouseMCPServer_intro.md)。

## 在 N8N 工作流 AI Agent 节点中增加 MCP Client

N8N MCP 客户端工具节点是一个[模型上下文协议 (MCP)](https://modelcontextprotocol.io/introduction)客户端，允许您使用外部 MCP 服务器公开的工具。您可以将 MCP 客户端工具节点连接到您的模型，以便使用 N8N 代理调用外部工具。**目前 N8N 仅支持 SSE 协议，还不支持通过 HTTP 协议与 MCP Server 互通**。

:-: ![](.topwrite/assets/image_1756887369109.png =795)

在 Agent 节点的 System Message 中填写：
您是 ClickZetta Lakehouse 资深产品专家，擅长借助 MCP Server Tools 帮助用户回答和解决问题，避免编造。对于 ClickZetta Lakehouse 相关的问题，如果没有合适的 MCP Tool，您需要先通过 `get_product_knowledge` 这个 MCP Tool 查询产品知识库获得知识，然后再通过合适的 Tool 执行获得结果。

## 配置AI Agent节点的MCP

使用以下参数配置节点。

* **SSE 端点**：您要连接的 MCP 服务器的 SSE 端点。

* **身份验证**：用于向 MCP 服务器进行身份验证的身份验证方法。选择 **“无”** 则无需身份验证即可尝试连接。

* **要包含的工具**：选择要向 AI 代理公开的工具：

  * **全部**：公开 MCP 服务器提供的所有工具。
  * **已选择**：激活 **要包含的工具** 参数，您可以在其中选择要向 AI 代理公开的工具。
  * **除以下所有**：激活 **要排除的工具** 参数，您可以在其中选择要避免与 AI 代理共享的工具。AI 代理将可以访问所有未选中的 MCP 服务器工具。

:-: ![](.topwrite/assets/image_1756887446000.png =614)

选择 **已选择**，即可看到 Tools 列表：

\:-:
![](.topwrite/assets/image_1756887497226.png =611)

## 测试Agent流程

在对话框中输入您的问题来操作 Lakehouse：

**问题1：我有哪些 Lakehouse 环境？**

:-: ![](.topwrite/assets/image_1756887670661.png =629)

^

**答复1**：

您当前有以下4个Lakehouse环境配置：

1. **aliyun\_shanghai\_prod**

   * **工作空间**: quick\_start
   * **Schema**: mcp\_demo
   * **虚拟集群**: default\_ap
   * **状态**: 已连接（当前活跃且默认）

2. **tencent\_shanghai\_prod**

   * **工作空间**: quick\_start
   * **Schema**: mcp\_demo
   * **虚拟集群**: default\_ap
   * **状态**: 已连接

3. **tencent\_beijing\_prod**

   * **工作空间**: quick\_start
   * **Schema**: public
   * **虚拟集群**: default\_ap
   * **状态**: 已连接

4. **tencent\_guangzhou\_prod**

   * **工作空间**: quick\_start
   * **Schema**: public
   * **虚拟集群**: default\_ap
   * **状态**: 已连接

当前活跃的环境是 **aliyun\_shanghai\_prod**。如果需要切换环境，请告诉我具体需求！

**问题2：帮我切换到 tencent_shanghai_prod**

**答复2**：

已成功将Lakehouse环境切换到 **tencent\_shanghai\_prod**，以下是验证信息：

* **新连接状态**：

  * **服务端点**: `ap-shanghai-tencentcloud.api.clickzetta.com`
  * **工作空间**: `quick_start`
  * **Schema**: `mcp_demo`
  * **实例ID**: `270738` (内部标识)

* **切换详情**：

  * 物理连接已重建，无配置漂移。
  * 处理耗时：2.83秒。

如需进一步验证当前上下文，可执行 `get_current_context`。
请继续告知后续操作需求！

**问题3：当前上下文是？**

**答复3：**

当前上下文信息如下：

* **实例ID**: `270738`
* **Schema**: `mcp_demo`
* **用户名**: `qiliang` (ID: `2162115`)
* **虚拟集群**: `default_ap`
* **工作空间**: `quick_start`
* **连接时间**: `2025-09-03 16:25:45` (UTC+8)

当前环境为 **tencent\_shanghai\_prod**（腾讯云上海生产环境），状态正常。如需其他操作请随时告知！

^

同样，您也可以在对话框中输入问题，进行 Lakehouse 相关的知识问答：

^

:-: ![](.topwrite/assets/image_1756888912810.png =813)

^

可以看到，通过 N8N 流程可以便捷地访问 Lakehouse 了！

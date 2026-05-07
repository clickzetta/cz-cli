# 配置和使用云器Lakehouse MCP Server

## 高级配置

### 1. 启用MCP工具集成

如果您的环境支持MCP（Model Context Protocol）工具，可以通过命令行方式添加[MCP服务器](LakehouseMCPServer.md)：

```bash
# 添加HTTP类型的MCP服务器
Datus> .mcp add --transport http clickzetta_mcp_http http://localhost:8002/mcp

# 或者添加SSE类型的MCP服务器
Datus> .mcp add --transport sse clickzetta_mcp_sse http://localhost:8003/sse

# 查看已添加的MCP服务器列表
Datus> .mcp list

# 检查MCP服务器连接状态
Datus> .mcp check clickzetta_mcp_http

# 调用MCP工具（格式：服务器名.工具名，具体工具名请通过.mcp check查看）
Datus> .mcp call clickzetta_mcp_http.工具名称

# 配置工具过滤器（可选）
Datus> .mcp filter set clickzetta_mcp_http --allowed 工具名1,工具名2 --enabled true

# 查看工具过滤器配置
Datus> .mcp filter get clickzetta_mcp_http

# 删除MCP服务器（如需要）
Datus> .mcp remove clickzetta_mcp_http
```

**MCP 命令说明**：

* `.mcp list` - 查看所有 MCP 服务器
* `.mcp check <name>` - 检查服务器连接状态并显示可用工具
* `.mcp call <server.tool>` - 调用特定工具，格式为“服务器名.工具名”
* `.mcp filter set <server> --allowed 工具名1,工具名2` - 设置允许的工具列表
* `.mcp filter get <server>` - 查看当前过滤器配置
* `.mcp remove <name>` - 删除 MCP 服务器

**重要提示**：具体可用的工具名称需要先添加 MCP 服务器，然后通过 `.mcp check <server_name>` 命令查看。

#### 通过subagent使用MCP工具（推荐方式）

添加MCP服务器后，建议通过subagent来使用MCP工具，这样可以在添加过程中选择需要的工具：

```bash
# 添加subagent（会启动交互式向导）
Datus> .subagent add

# 查看所有配置的subagent
Datus> .subagent list

# 为subagent构建知识库（可选）
Datus> .subagent bootstrap agent_name

# 删除subagent（如需要）
Datus> .subagent remove agent_name
```

**subagent 命令说明**：

* `.subagent add` - 启动交互式向导添加新的智能代理，可以在此过程中选择 MCP 工具
* `.subagent list` - 列出所有已配置的子代理
* `.subagent bootstrap <agent_name>` - 为指定代理构建专门的知识库
* `.subagent remove <agent_name>` - 删除指定的子代理

**添加 subagent 时请设置**：

```
agent_description: ClickZetta Lakehouse assistant with MCP tool integration
```

```
rules:
      - Detect user intent: distinguish between analysis requests and SQL generation
        requests
      - For analysis/explanation requests: focus on interpreting results, use markdown
        format
      - For SQL generation requests: provide executable statements with explanations
        in JSON format
      - Use MCP tools for instance switching, job history, system operations,etc
      - When users mention "instance switching", "job history", or similar operations
        - call MCP tools
      - Prefer specialized analysis tools over basic data collection tools when available
      - Use single comprehensive tools over multiple basic tool combinations when
        possible
      - Choose tools designed for the specific analysis type rather than generic tools
      - When using MCP analysis tools: focus on explaining the tool results rather
        than auto-generating SQL
```

通过 subagent 方式使用 MCP 工具的优势：

* 可以在添加过程中交互式选择需要的工具
* 为每个场景创建专门的智能代理
* 支持构建专门的知识库来提升分析能力

**MCP 工具启用后的功能**：

* 实例管理和切换
* 作业历史查询
* 高级数据分析工具
* 系统监控功能

***

*本指南最后更新时间：2025 年 11 月*
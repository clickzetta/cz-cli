# analytics-agent-knowledge 规格说明

## Purpose
定义 `analytics-agent knowledge` 命令组的第一批能力，包括结构化知识 CRUD、知识空间查询/创建，以及文档知识的 folder/file 基础命令面。

## Requirements

### Requirement: 本地 open token 上下文优先级

When the active profile already provides Analytics Agent specific `agent` context, CLI MUST prefer that open-token tenant context over the normal Studio tenant resolution path.

#### Scenario: profile 中已有 agent 上下文时优先使用它

- **WHEN** 当前 profile 已配置 `agent.token`、`agent.tenant_id`、`agent.user_id`
- **AND** 用户执行 `cz-cli --profile <name> analytics-agent knowledge ...`
- **THEN** CLI MUST use `agent.token` as `Authorization`
- **AND** CLI MUST use `agent.tenant_id` as the `tenantId` query parameter
- **AND** CLI MUST NOT fall back to the ordinary Studio tenant resolved from login state

#### Scenario: profile 中没有完整 agent 上下文时回退 Studio

- **WHEN** 当前 profile 未提供完整的 `agent.token`、`agent.tenant_id`、`agent.user_id`
- **THEN** CLI MUST fall back to the existing Studio context resolution path
- **AND** the existing non-agent command behavior MUST remain unchanged

### Requirement: 结构化知识 CRUD

CLI MUST provide `analytics-agent knowledge list/create/update/delete` for structured knowledge entries by calling open analytics-agent knowledge endpoints.

#### Scenario: 列出结构化知识

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge list`
- **THEN** CLI MUST call the open knowledge list endpoint
- **AND** the primary output MUST expose user-facing fields including knowledge id, aliases, type, status, and bound domain ids when present

#### Scenario: 创建文本知识

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --alias <alias> --content <text>`
- **THEN** CLI MUST call the open knowledge create endpoint with a text-knowledge payload
- **AND** the request MUST map `--content` to the stored text content field
- **AND** the success output MUST include the created knowledge id and aliases

#### Scenario: 从本地文件创建文本知识

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --alias <alias> --file <local-path>`
- **THEN** CLI MUST read the local file content before sending the request
- **AND** CLI MUST call the open knowledge create endpoint with the loaded text content
- **AND** the success output MUST include the created knowledge id and aliases

#### Scenario: 更新文本知识

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge update <knowledge-id> --alias <alias> --content <text>`
- **THEN** CLI MUST call the open knowledge update endpoint for that id
- **AND** the request MUST preserve the knowledge id in the path rather than the JSON body only

#### Scenario: 获取结构化知识详情

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge get <knowledge-id>`
- **THEN** CLI MUST call the open knowledge detail endpoint for that id
- **AND** the primary output MUST include the knowledge id, aliases, type, and content or dictionary payload

#### Scenario: 删除结构化知识

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge delete <knowledge-id>`
- **THEN** CLI MUST call the open knowledge delete endpoint for that id
- **AND** the command MUST succeed on the backend no-data success shape

#### Scenario: 创建知识缺少内容

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --alias <alias>` without `--content` and without `--dictionary`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that text knowledge requires content

#### Scenario: 从本地文件创建知识时文件不存在

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge create --alias <alias> --file <missing-path>`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that the local path does not exist

### Requirement: 知识空间查询与维护

CLI MUST provide `analytics-agent knowledge space list/create/rename/delete` for document knowledge spaces.

#### Scenario: 列出知识空间

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space list`
- **THEN** CLI MUST call the open knowledge space list endpoint
- **AND** the primary output MUST expose user-facing fields including space id, name, storage backend, file count, and bound domain ids when present

#### Scenario: 创建知识空间

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space create --name <name>`
- **THEN** CLI MUST call the open knowledge space create endpoint
- **AND** the success output MUST include the created space id and name

#### Scenario: 重命名知识空间

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space rename <space-id> --name <new-name>`
- **THEN** CLI MUST call the open knowledge space update endpoint
- **AND** the request MUST keep `space-id` in the request path
- **AND** the success output MUST include the renamed space id and new name

#### Scenario: 删除知识空间

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space delete <space-id>`
- **THEN** CLI MUST call the open knowledge space delete endpoint
- **AND** the command MUST succeed on the backend no-data success shape

#### Scenario: 删除知识空间兼容 code 200 的 no-data success

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space delete <space-id>`
- **AND** 后端返回 `code=200`、`success=false`、`message=操作成功`、`data=null`
- **THEN** CLI MUST 视该响应为成功
- **AND** 退出码 MUST 为 0

#### Scenario: 知识空间写操作 help 不暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space create --help`
- **THEN** help 中不包含 `--body`

#### Scenario: 知识空间重命名 help 不暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge space rename --help`
- **THEN** help 中不包含 `--body`

### Requirement: 文档知识基础命令面

CLI MUST provide a first explicit command surface for document knowledge folders and files by calling open analytics-agent knowledge node endpoints.

### Requirement: 文档知识节点 domain 绑定

CLI MUST provide an explicit node-level domain binding surface for existing document knowledge nodes, and it MUST align with the backend node inheritance model instead of inventing a space-level binding concept.

#### Scenario: 绑定节点到一个或多个 domain

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge node bind-domain <space-id> <node-id> --domain-id <id1> --domain-id <id2>`
- **THEN** CLI MUST call the internal KB node-domain set endpoint for that node
- **AND** the request body MUST send `node-id` together with the repeated `--domain-id` values as `domainIds`
- **AND** CLI MUST use `space-id` and `node-id` to fetch the refreshed node detail after the write succeeds
- **AND** the success output MUST include the node basic metadata together with the node's effective `domainIds`

#### Scenario: 从节点解绑一个或多个 domain

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge node unbind-domain <space-id> <node-id> --domain-id <id>`
- **THEN** CLI MUST call the internal KB node-domain remove endpoint for that node
- **AND** the request body MUST send `node-id` together with the repeated `--domain-id` values as `domainIds`
- **AND** CLI MUST use `space-id` and `node-id` to fetch the refreshed node detail after the write succeeds
- **AND** the success output MUST include the node basic metadata together with the node's latest effective `domainIds`
- **AND** when the node no longer has direct bindings but still inherits from an ancestor, the output MUST keep the inherited domain information instead of pretending the node is fully unbound

#### Scenario: 绑定节点缺少 domain-id

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge node bind-domain <space-id> <node-id>` without any `--domain-id`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that at least one `--domain-id` is required

#### Scenario: 绑定节点传入非法 domain-id

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge node bind-domain <space-id> <node-id> --domain-id abc`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that `--domain-id` must be a positive integer

#### Scenario: 绑定写成功但回读 detail 失败时不误判整条命令失败

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge node bind-domain <space-id> <node-id> --domain-id 195`
- **AND** internal KB node-domain set/remove write succeeds
- **AND** the follow-up `detail/with-path` request returns `5xx`
- **THEN** CLI MUST still treat the write command itself as success
- **AND** the success output MUST preserve the requested `space-id`、`node-id`、`domainIds`
- **AND** the output MUST clearly indicate that detail refresh failed and the user should re-check the node detail later

#### Scenario: 列出某目录下的节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder list <space-id>`
- **THEN** CLI MUST call the open knowledge node list endpoint for that space
- **AND** the primary output MUST include folder and file entries under the requested parent folder
- **AND** each entry MUST expose user-facing fields including node id, parent id, node type label, name, and path when present

#### Scenario: 创建文件夹

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder create <space-id> --name <folder-name>`
- **THEN** CLI MUST call the open knowledge folder create endpoint for that space
- **AND** the success output MUST include the created folder node id and name

#### Scenario: 重命名文件夹

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder rename <space-id> <node-id> --name <new-name>`
- **THEN** CLI MUST call the open knowledge node update endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the renamed folder node id and new name

#### Scenario: 按路径查找文件夹

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder by-path <space-id> --path <remote-path>`
- **THEN** CLI MUST call the open knowledge node by-path endpoint for that space
- **AND** when the matched node is a folder, the output MUST expose `found=true` and the folder node metadata
- **AND** when the matched node is not a folder, CLI MUST normalize the result to `found=false`

#### Scenario: 按路径查找文件夹时兼容前导斜杠

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder by-path <space-id> --path /reports`
- **THEN** CLI MUST normalize the remote path before sending the request
- **AND** the query string MUST send `path=reports` instead of preserving the leading slash

#### Scenario: 删除文件夹节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder delete <space-id> <node-id>`
- **THEN** CLI MUST call the open knowledge node delete endpoint
- **AND** the command MUST succeed on the backend no-data success shape

#### Scenario: 移动文件夹节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder move <space-id> <node-id> --parent-id <target-parent-id>`
- **THEN** CLI MUST call the open knowledge node move endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the moved folder node id and updated path when present

#### Scenario: 复制文件夹节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder copy <space-id> <node-id> --parent-id <target-parent-id>`
- **THEN** CLI MUST call the open knowledge node copy endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the copied folder node id and updated path when present

#### Scenario: 按名称搜索文件夹节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder search <space-id> --keyword <text>`
- **THEN** CLI MUST call the open knowledge node search endpoint for that space
- **AND** CLI MUST send a `nodeType=folder` filter
- **AND** the primary output MUST expose `count` together with the matched folder node list

#### Scenario: 搜索文件夹节点缺少关键字

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder search <space-id>` without `--keyword`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that `--keyword` is required

#### Scenario: 更新目录子节点排序

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder sort <space-id> --node-id <id1> --node-id <id2>`
- **THEN** CLI MUST call the open knowledge node sort endpoint for that space
- **AND** the request MUST send the ordered `nodeIds` array
- **AND** the command MUST succeed on the backend no-data success shape

#### Scenario: 更新目录排序兼容 code 200 的 no-data success

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder sort <space-id> --node-id <id1> --node-id <id2>`
- **AND** 后端返回 `code=200`、`success=false`、`message=操作成功`、`data=null`
- **THEN** CLI MUST 视该响应为成功
- **AND** 退出码 MUST 为 0

#### Scenario: 更新排序缺少 node-id

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder sort <space-id>` without any `--node-id`
- **THEN** CLI MUST reject the request before sending it
- **AND** the error message MUST explain that at least one `--node-id` is required

#### Scenario: 文件夹写操作 help 不暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder rename --help`
- **THEN** help 中不包含 `--body`

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder move --help`
- **THEN** help 中不包含 `--body`

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge folder copy --help`
- **THEN** help 中不包含 `--body`

#### Scenario: 获取文件内容

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file get <space-id> <node-id>`
- **THEN** CLI MUST call the open knowledge file-content endpoint for that file node
- **AND** the output MUST include the file node metadata together with text content when the file is plain text

#### Scenario: 列出目录下的文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file list <space-id>`
- **THEN** CLI MUST call the open knowledge node list endpoint for that space
- **AND** CLI MUST only keep entries whose `nodeTypeLabel` is `file`
- **AND** the primary output MUST expose user-facing file fields including node id, parent id, name, and path when present

#### Scenario: 按路径查找文件

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file by-path <space-id> --path <remote-path>`
- **THEN** CLI MUST call the open knowledge node by-path endpoint for that space
- **AND** when the matched node is a file, the output MUST expose `found=true` and the file node metadata
- **AND** when the matched node is not a file, CLI MUST normalize the result to `found=false`

#### Scenario: 按路径查找文件时兼容前导斜杠

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file by-path <space-id> --path /reports/report.md`
- **THEN** CLI MUST normalize the remote path before sending the request
- **AND** the query string MUST send `path=reports/report.md` instead of preserving the leading slash

#### Scenario: 删除文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file delete <space-id> <node-id>`
- **THEN** CLI MUST call the open knowledge node delete endpoint
- **AND** the command MUST succeed on the backend no-data success shape

#### Scenario: 删除文件节点兼容 code 200 的 no-data success

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file delete <space-id> <node-id>`
- **AND** 后端返回 `code=200`、`success=false`、`message=操作成功`、`data=null`
- **THEN** CLI MUST 视该响应为成功
- **AND** 退出码 MUST 为 0

#### Scenario: 移动文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file move <space-id> <node-id> --parent-id <target-parent-id>`
- **THEN** CLI MUST call the open knowledge node move endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the moved file node id and updated path when present

#### Scenario: 复制文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file copy <space-id> <node-id> --parent-id <target-parent-id>`
- **THEN** CLI MUST call the open knowledge node copy endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the copied file node id and updated path when present

#### Scenario: 按名称搜索文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file search <space-id> --keyword <text>`
- **THEN** CLI MUST call the open knowledge node search endpoint for that space
- **AND** CLI MUST send a `nodeType=file` filter
- **AND** the primary output MUST expose `count` together with the matched file node list

#### Scenario: 重命名文件节点

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file rename <space-id> <node-id> --name <new-name>`
- **THEN** CLI MUST call the open knowledge node update endpoint for that node
- **AND** the request MUST keep both `space-id` and `node-id` in the request path
- **AND** the success output MUST include the renamed file node id, new name, and updated path when present

#### Scenario: 文件写操作 help 不暴露 body 参数

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file rename --help`
- **THEN** help 中不包含 `--body`

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file move --help`
- **THEN** help 中不包含 `--body`

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file copy --help`
- **THEN** help 中不包含 `--body`

#### Scenario: 上传单个本地文件

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file upload <space-id> <local-file>`
- **THEN** CLI MUST verify the local path is a file before any network upload
- **AND** CLI MUST request an upload url from the open knowledge upload-url endpoint
- **AND** CLI MUST upload the file bytes to the returned presigned url
- **AND** CLI MUST notify the open knowledge upload-complete endpoint after the upload

#### Scenario: 上传文件到指定目标目录

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file upload <space-id> <local-file> --target-path <remote-path>`
- **THEN** CLI MUST create or reuse `<remote-path>` as the remote parent folder
- **AND** the uploaded file MUST appear under that folder

#### Scenario: 已存在同路径文件时覆盖上传

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file upload <space-id> <local-file> --target-path <remote-path>`
- **AND** the final remote file path already exists as a file node
- **THEN** CLI MUST resolve that existing file node by path
- **AND** CLI MUST request an overwrite upload url using the existing node id
- **AND** the success output MUST mark the upload as overwritten

#### Scenario: 目标路径落到文件节点上

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file upload <space-id> <local-file> --target-path <remote-path>`
- **AND** `<remote-path>` resolves to an existing file node instead of a folder
- **THEN** CLI MUST fail before uploading file bytes
- **AND** the error message MUST explain that the target path must be a folder path

#### Scenario: 文件内容读取必须绑定 space

- **WHEN** 用户执行 `cz-cli analytics-agent knowledge file get <space-id> <node-id>`
- **THEN** CLI MUST include both `space-id` and `node-id` in the request path or query expected by the open API
- **AND** the API MUST reject a node that does not belong to the requested space

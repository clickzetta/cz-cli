## AI\_COMPLETE

`AI_COMPLETE` 是云器 Lakehouse 平台中用于生成式 AI 任务的核心标量函数。它允许用户在 SQL 环境中直接调用大规模语言模型（LLM），根据文本提示或多模态输入生成响应（补全），从而完成文本补全、翻译、情感分析、代码生成及复杂推理等任务。

云器将 AI 计算下沉至存储层与执行引擎，确保数据在平台内部即可实现智能化处理，无需流转至外部环境，从而在保障数据安全的同时极大地降低了任务延迟。

用户可以提供以下类型的输入：

* **文本提示**：提供一个字符串形式的 Prompt，由模型生成响应。详见 AI\_COMPLETE（单字符串）。
* **单张图像与文本提示**：提供一张图像和一个文本提示，由模型根据图像与提示生成响应。详见 AI\_COMPLETE（单图像）。

### 语法

该函数的语法取决于用户提供的输入类型：

* AI\_COMPLETE（单字符串）
* AI\_COMPLETE（单图像）

## AI\_COMPLETE（单字符串）

使用支持的语言模型，根据文本提示生成响应（补全）。

### 语法

sql

```sql
AI_COMPLETE(<model>,<prompt> [,<model_parameters>][,<response_format>][,<show_details>])
```

该函数包含 **2 个必需参数**和 **3 个可选参数**，支持位置参数语法和命名参数语法。

### 参数说明

**必需参数**

\`\`（STRING）

指定要调用的语言模型。模型的来源有两种：[模型管理](AI_Gateway.md) 中的**Endpoint** 和 **API Connection 连接对象**。在函数的第一个参数中，通过不同的前缀来区分模型来源。

**来源一**：模型管理中的 Endpoint：

模型管理是云器 Lakehouse 平台统一管理模型服务的网关层。在 API Gateway 中注册的模型可直接通过 `endpoint:` 前缀引用。

**语法格式**：

```scheme
'endpoint:<endpoint名称>'
```

**使用示例**：

```sql
SELECT AI_COMPLETE('endpoint:lis_openai_llm','prompt string',GET_PRESIGNED_URL(VOLUME volume_name, '<relative_file_path>', <expiration_time>));
```

其中，`lis_openai_llm` 模型管理 endpoint 是由平台管理员在 API Gateway 中预先配置，包含模型供应商、模型版本、认证凭据等信息。普通用户无需关心底层连接细节，只需通过端点名称即可调用对应模型。

***

**来源二**：API Connection 连接对象

API Connection 是用户在 Lakehouse 中自行创建的模型服务连接对象，适用于需要自定义模型服务地址、认证密钥或对接私有化部署模型的场景。通过 `CREATE API CONNECTION` 语句创建连接对象后，即可在 `AI_COMPLETE` 中引用。

**创建连接对象语法**：

sql

```sql
CREATE API CONNECTION <connection_name>
    TYPE ai_function
    PROVIDER = '<provider_name>'
    BASE_URL = '<service_endpoint_url>'
    API_KEY = '<your_api_key>';
```

**创建连接对象示例**：

```sql
CREATE API CONNECTION conn_bailian
    TYPE ai_function
    PROVIDER = 'bailian'
    BASE_URL = 'https://dashscope.aliyuncs.com/api/v1'
    API_KEY = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx';
```

其中各字段含义如下：

`connection_name` 为连接对象的自定义名称，后续在 `AI_COMPLETE` 中通过该名称引用；

`TYPE` 固定为 `ai_function`，表示该连接用于 AI 函数调用；

`PROVIDER` 指定模型供应商标识，如 `'bailian'`（百炼）、`'openai'`、`'anthropic'` 等；

`BASE_URL` 为模型服务的 API 基础地址；`API_KEY` 为调用该服务所需的认证密钥。

***

**在 AI\_COMPLETE 中引用连接对象**：

```sql
SELECT AI_COMPLETE('connection:conn_bailian','请简要介绍量子计算的基本原理。');
```

**语法格式**：

```scheme
'connection:<连接对象名称>'
```

###

### 示例

**基础用法：单个文本提示**

```
SELECT AI_COMPLETE(
    'endpoint:aliyun-qwen3max',
    '中国的首都在哪里?'
);

```

**图像识别**：

使用支持的多模态语言模型，根据单张图像与文本提示生成响应（补全）。该模式适用于视觉问答（VQA）、图像内容描述、图像信息提取、OCR 识别等需要模型理解图像内容的场景。

```
SELECT 
        a.id, 
        a.question,
        a.answer AS standard_answer,
        -- 1. AI生成答案
        ai_complete(
            'endpoint:doubao-seed-2-0-pro-260215',
            JSON_OBJECT(
                'system', 'You are a VQA assistant. Answer based on the image in English. Be extremely concise (1-5 words).',
                'user', a.question,
                'images', ARRAY(CONCAT('volume://volumes/datagpt_ws/image_hub/my_images/', LPAD(CAST(a.id AS STRING), 11, '0'), '.jpg'))
            )
        ) AS ai_generated_answer,
        -- 2. 生成图片预览URL
        get_presigned_url(
            VOLUME lakehouse_ai.image_hub.my_images,
            LPAD(CAST(a.id AS STRING), 11, '0') || '.jpg',
            7200  
        ) AS image_preview_url,
        -- 3. 图片存储路径
        CONCAT('volume://volumes/lakehouse_ai/image_hub/my_images/', LPAD(CAST(a.id AS STRING), 11, '0'), '.jpg') AS image_path
    FROM 
        lakehouse_ai.image_hub.evjvqa_annotations_20 AS a
```

效果如下：

![](/.topwrite/assets/ai_complete_pic.jpeg)

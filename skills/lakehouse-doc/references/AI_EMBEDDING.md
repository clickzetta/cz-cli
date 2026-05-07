## AI\_EMBEDDING

使用支持的嵌入模型（Embedding Model）将文本转换为高维向量表示。生成的向量可用于语义搜索、文本相似度计算、聚类分析、推荐系统等下游任务。

### 语法

```sql
AI_EMBEDDING(<model>, <input> [ , <model_parameters> ])
```

该函数包含 **2 个必需参数**和 **1 个可选参数**，支持位置参数语法和命名参数语法。

### 参数说明

**必需参数**

**`model`**

指定要调用的嵌入模型。与 `AI_COMPLETE` 一致，模型来源分为两种：API Gateway 端点和 API Connection 连接对象。

通过 API Gateway 端点调用时，使用 `endpoint` 前缀加端点名称的格式：

```scheme
'endpoint:<端点名称>'
```

通过 API Connection 连接对象调用时，需先通过 `CREATE API CONNECTION` 创建连接，再使用 `connection/` 前缀引用：

```scheme
'connection:<连接对象名称>'
```

> **说明**： 请确保所指定的模型为嵌入模型（Embedding Model），而非对话补全模型。嵌入模型专门用于将文本映射为固定维度的数值向量，常见的嵌入模型包括 OpenAI 的 `text-embedding-3-small`、`text-embedding-3-large`，阿里云百炼的 `text-embedding-v4` 等。

**`\`**（STRING）

需要转换为向量的输入文本。可以是单个词语、一个句子、一段文字，也可以是来自数据表中某个字段的值。输入文本的最大长度受所选模型的上下文窗口限制，超出限制可能导致文本被截断或调用失败。

**可选参数**

**`\`**（OBJECT）

以 JSON 对象形式传入的模型超参数，用于控制嵌入模型的行为。不同模型支持的参数可能有所不同，常见参数如下：

| 参数                    | 类型     | 说明                                                                                                                      |
| --------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `input`               | STRING | 指定输入内容的类型。常见取值为 `'text'`（普通文本）和 `'query'`（查询文本）。部分模型会根据输入类型对向量做针对性优化，例如在检索场景中，文档内容使用 `'text'`，用户查询使用 `'query'`，可提升检索精度。 |
| `embedding.dimension` | STRING | 指定输出向量的维度。较高的维度通常能保留更丰富的语义信息，但会占用更多存储空间和计算资源。常见取值包括 `'256'`、`'512'`、`'1024'`、`'1536'` 等，具体支持的维度范围取决于所选模型。               |

参数示例：

```sql
JSON '{
    "input": "text",
    "embedding.dimension": "1024"
}'
```

### 示例

```
SELECT AI_EMBEDDING(
    'endpoint：lis_openai_embedding',
    '中国的首都？',
    JSON '{
        "input": "text",
        "embedding.dimension": "1024"
    }'
);
```

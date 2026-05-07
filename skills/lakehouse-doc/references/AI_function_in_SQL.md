# AI 函数

## 概述

在云器 Lakehouse 中，AI 函数的实现**依托于**外部函数（External Function）的框架。外部函数（亦称远程函数，Remote Function）是一种特殊的自定义函数（UDF），它允许用户通过 Python 或 Java 语言定义函数逻辑，但其核心计算任务会被\*\*卸载（offload）\*\*到外部的远程服务执行（支持的远程服务包括：阿里云的函数计算 FC、腾讯云的云函数 SCF）。在执行过程中可调用：

* **在线服务**：以 API 形式对外提供的在线服务，如 AI 在线模型服务（例如大语言模型 API、云平台提供的在线 AI API 服务）。
* **离线功能**：将特定功能函数代码、依赖库、模型和数据等文件打包成的离线服务包，如从 Hugging Face 下载的图像识别模型等。

云器 Lakehouse 通过创建 API Connection，在元数据中保存外部函数计算服务的连接和访问信息。外部函数通过 HTTP 协议调用外部函数计算服务，实现数据处理并返回结果。
![](.topwrite/assets/a7546df1-be39-41e9-9c80-e0e90ce3d353.svg)
Lakehouse 平台在获得用户预先授权后，于创建外部函数时，将自动在客户账号下的函数计算服务中部署该函数。当用户在 SQL 查询中使用外部函数时，由外部函数实现与外部计算服务的安全连接、数据处理并返回查询结果。

## 外部函数创建主要流程

请参考：[使用流程: External Function](RemoteFunctionBestPractice.md)

## 使用外部函数开发 AI 函数

请参考以下开发指南：

* [External Function(Python3)](RemoteFunctionDevGuidePython3.md)
* [External Function(Java)](ExternalFunctionDevGuideJava.md)

^

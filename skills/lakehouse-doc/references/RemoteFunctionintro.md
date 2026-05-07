# EXTERNAL FUNCTION

## 概述

EXTERNAL FUNCTION（REMOTE FUNCTION）是在云器 Lakehouse 中通过 Python 和 Java 语言创建的自定义函数（UDF），通过远程服务执行（支持的远程服务包括：阿里云的函数计算 FC、腾讯云的云函数 SCF）。在执行过程中可调用：

* 在线服务：以 API 形式对外提供的在线服务，例如：AI 在线模型服务（如大语言模型 API、云平台提供的在线 AI API 服务）。
* 离线功能：将特定功能函数代码、依赖库、模型和数据等文件打包成的离线服务包，例如从 Hugging Face 下载的图片识别模型等。

云器 Lakehouse 通过创建 API CONNECTION，在元数据中保存外部函数计算服务的连接和访问信息。EXTERNAL FUNCTION 通过 HTTP 协议调用外部函数计算服务进行数据处理，并返回结果。
![](.topwrite/assets/a7546df1-be39-41e9-9c80-e0e90ce3d353.svg)
云器 Lakehouse 平台通过用户的预先授权，在创建外部函数时，将自动在客户账号下的函数计算服务中创建对应的函数。当用户在 SQL 查询中使用外部函数时，外部函数会实现与外部计算服务的安全连接、数据处理，并返回查询结果。

## EXTERNAL FUNCTION 创建流程

请参考：[使用流程: External Function](RemoteFunctionBestPractice.md)

* 用户开通云上的函数计算服务（如阿里云的函数计算 FC）和对象存储服务。
* 将函数执行代码、可执行文件、依赖库、模型和数据文件打包上传至对象存储。
* 授予云器 Lakehouse 操作上述服务和访问函数文件（包）的权限。
* 用户执行连接和外部函数 DDL 语句以生成 UDF，并在查询中使用。

## EXTERNAL FUNCTION 执行过程

* 用户在云器 Lakehouse SQL 语句中调用 External Function。
* 云器 Lakehouse 根据提供的服务地址和认证信息，发送 HTTP 请求以调用并运行函数。
* 云器 Lakehouse 获取响应信息并返回结果。

## EXTERNAL FUNCTION 优势

* 可以使用 Remote Function 调用外部丰富的数据处理能力，以补充传统 SQL 计算模型。例如，可调用大语言模型（LLM）、图像处理、音视频处理等服务或能力，以补充 SQL 在非结构化数据处理方面的能力。
* 可以直接访问外部网络，不受云器 Lakehouse 网络约束。

## 使用限制

* 目前只支持 Java 和 Python 编程语言，支持的运行环境为 Java 8 和 Python 3.10。
* 如果依赖原生库（如包含 .so 文件的库），需要兼容 Python 3.10 的 ABI。
* 当程序及其依赖文件压缩后大于 500 MB 时，需要以容器镜像方式创建函数，请参考[实践：利用Hugging Face 图片识别模型处理图片数据](RemoteFunctionOnACR.md)。

## EXTERNAL FUNCTION 收费

* 支持自定义函数类型：UDF，UDAF，UDTF
* 远程服务调用的费用：参考云厂商的函数计算服务费用信息（阿里云请参考[链接](https://help.aliyun.com/zh/fc/product-overview/billing-overview?spm=a2c4g.11186623.0.0.4d5b19b3rrOy7Y)，腾讯云请参考[链接](https://cloud.tencent.com/document/product/583/17299)）。
* 使用云器 Lakehouse 的计算资源所产生的计算费用。
* 数据传输费用：任何涉及公网数据流出的费用。内网传输不产生费用。

## 使用 REMOTE FUNCTION 开发 UDF 函数

请参考以下开发指南：

* [External Function(Java)](ExternalFunctionDevGuideJava.md)
* [External Function(Python3)](RemoteFunctionDevGuidePython3.md)

^

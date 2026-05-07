# Lakehouse Python SDK


ClickZetta Lakehouse Python SDK 是为 Python 开发者提供的一套工具包，旨在简化与 ClickZetta Lakehouse 交互的过程。本 SDK 的 Python 包为 clickzetta-connector。您可以在 https://pypi.org/project/clickzetta-connector/#history 查看其发布历史。


- ClickZetta Connector 遵循 PEP 249 规范，提供了一个符合 Python Database API 风格的 SQL 调用接口。通过该接口，您可以轻松地在 Python 应用程序中执行 SQL 查询、插入、更新和删除操作。

- 支持批量数据上传（bulkload）功能，可以大幅提高数据导入速度。这对于处理大量数据的场景尤为有用。

- 支持实时上传功能，允许用户将数据逐行发送到 Lakehouse，适用于对数据新鲜度要求较高的场景。

通过该 Python SDK，您可以轻松地在 Python 应用程序中与 ClickZetta Lakehouse 进行交互，满足各种数据处理需求。

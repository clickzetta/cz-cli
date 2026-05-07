# 展示外部函数

本命令用于列出当前用户创建的外部函数。通过该命令，用户可以方便地查看和管理已创建的外部函数。

相关函数：[创建连接](CREATECONNECTION.md)，[创建外部函数](<CREATE_EXTERNATL_FUNCTION.md>)，[删除函数](drop-function.md)

## 语法

```
SHOW EXTERNAL FUNCTIONS [ LIKE '<pattern>' ];
```

## 参数说明

**LIKE '<pattern>'**：此参数用于根据函数名称过滤命令输出。支持 SQL 通配符 `%` 和 `_`。

## 使用说明

- 执行该命令无需启动 VirtualCluster（VC），因此不会消耗 CRU 资源。
- 命令 `SHOW FUNCTIONS` 和 `SHOW EXTERNAL FUNCTIONS` 均可用于显示外部函数信息。

## 示例

1. 显示所有外部函数：

   ```
   SHOW EXTERNAL FUNCTIONS;
   ```

2. 按照正则表达式规则显示外部函数，例如显示名称中包含 "hash" 的函数：

   ```
   SHOW EXTERNAL FUNCTIONS LIKE 'hash%';
   ```



通过上述示例，用户可以灵活地使用 `LIKE` 参数来过滤和查看外部函数。这有助于用户更好地管理和维护外部函数，确保数据仓库中函数的准确性和可用性。
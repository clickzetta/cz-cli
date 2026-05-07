# DESC FUNCTION

`DESCRIBE FUNCTION` 是 Lakehouse SQL 中的一个实用命令，用于获取关于已创建函数的详细信息。此命令可以帮助用户理解函数的名称、参数、返回类型以及函数体等关键信息。

## 语法

sql

```sql
DESC[RIBE] FUNCTION [EXTENDED] function_name;
```

##  参数说明

* **`function_name`**：要描述的函数的名称。如果函数位于特定的架构中，需要使用 `schema_name.function_name` 的格式指定。
* **`EXTENDED`**：（可选）关键字，用于获取函数的扩展信息，包括函数的注释、确定性、数据访问属性以及函数的所有者和创建时间等。

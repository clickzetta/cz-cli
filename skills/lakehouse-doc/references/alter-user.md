## 功能

修改用户属性，设置用户的默认执行集群和默认 Schema

## 语法
```
ALTER USER user_name SET
[DEFAULT_VCLUSTER= vc_name] 
[DEFAULT_SCHEMA=schema_name]
```
**1. DEFAULT_VCLUSTER**: 为用户指定默认的计算资源。如果未指定，则使用全局默认计算资源。

**2. DEFAULT_SCHEMA**: 为用户指定默认的模式（schema）。如果用户未指定默认模式，登录时需要指定要访问的模式，否则会报错。如果指定了默认模式，用户登录时将默认使用该模式。在会话中使用 `USE` 命令可以切换到其他模式。优先级：`USE` 命令 > 默认模式。
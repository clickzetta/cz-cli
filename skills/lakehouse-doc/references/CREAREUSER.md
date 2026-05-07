## 功能

将用户添加到工作空间中，以便用户能够访问和操作其中的资源。

## 语法

```SQL
CREATE USER [IF NOT EXISTS] user_name
[DEFAULT_VCLUSTER= vc_name] 
[DEFAULT_SCHEMA=schema_name]
[COMMENT  "" ];
```

**1.user\_name**: 用户标识，必须是已在用户管理系统中创建的用户名。

**2.DEFAULT\_VCLUSTER**: 为用户指定默认的计算资源。如果未指定，则使用全局默认计算资源。

**3.DEFAULT\_SCHEMA**: 为用户指定默认的模式（schema）。如果用户未指定默认模式，登录时需要指定要访问的模式，否则将报错。如果指定了默认模式，用户登录时将默认使用该模式。在会话中使用 `USE` 命令可以切换到其他模式。优先级：`USE` 命令 > 默认模式。

**4. COMMENT**: 为用户添加注释信息。

## 示例

1. 将用户 uat\_test 添加到工作空间中，使用全局默认计算资源和模式：

   ```SQL
   CREATE USER uat_test;
   ```

2. 将用户 uat\_test 添加到工作空间中，并为其指定计算资源为 vcluster1 和默认模式为 schema1：

   ```SQL
   CREATE USER uat_test DEFAULT_VCLUSTER=vcluster1 DEFAULT_SCHEMA=schema1;
   ```

3. 将用户 uat\_test 添加到工作空间中，并为其添加注释信息：

   ```SQL
   CREATE USER uat_test COMMENT "This is a test user for UAT environment.";
   ```

通过以上示例，您可以根据需要将用户添加到工作空间中，并为其分配适当的资源和模式。
# 从当前workspace移除用户

## 功能

本命令用于从当前 workspace 中移除指定的用户，以确保只有授权的用户可以访问和操作该 workspace。

## 语法

```SQL
DROP USER [IF EXISTS] user_name;
```

- `IF EXISTS`：可选参数，用于判断指定的用户是否存在于当前 workspace 中。若存在，则执行移除操作；若不存在，则不执行任何操作。
- `user_name`：需要从当前 workspace 中移除的用户的名称。

## 使用示例

1. 移除名为 “uat_test” 的用户：

```SQL
DROP USER uat_test;
```

2. 移除名为 “john_doe” 的用户，如果该用户不存在，则不执行任何操作：

```SQL
DROP USER IF EXISTS john_doe;
```

## 注意事项

- 在执行本命令之前，请确保您有足够的权限来移除指定的用户。
- 移除用户后，该用户将无法访问或操作当前 workspace 中的任何资源。请谨慎操作，以免造成不必要的损失。
- 如果您希望移除多个用户，请分别执行多次 `DROP USER` 命令。
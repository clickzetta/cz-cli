## 功能描述

`ALTER SCHEMA` 语句用于调整指定 schema 的名称、属性和注释。通过该语句，用户可以更新 schema 的注释（comment）和属性（properties），以适应数据处理需求和组织结构的变化。

## 修改 Schema 的名称

语法：

```SQL
ALTER SCHEMA schema_name RENAME TO new_name;
```

## 修改 Schema 注释

要修改 schema 的注释，可使用以下语法：

```SQL
ALTER SCHEMA schema_name SET COMMENT  'new_comment';
```

### 示例

1. 修改 `rc4_l` schema 的注释为 `rc7`：

   ```SQL
   ALTER SCHEMA rc4_l SET COMMENT 'rc7';
   ```

   执行该语句后，使用 `DESC` 命令验证注释是否修改成功：

   ```SQL
   DESC SCHEMA rc4_l;
   ```

   预期输出结果：

   ```
   +--------------------+-------------------------+
   |     info_name      |       info_value        |
   +--------------------+-------------------------+
   | name               | rc4_l                   |
   | creator            | UAT_TEST                |
   | created_time       | 2023-12-15 20:38:14.126 |
   | last_modified_time | 2023-12-20 14:54:59.826 |
   | comment            | rc7                     |
   +--------------------+-------------------------+
   ```

## 修改 Schema 属性

除了修改注释，还可以为 schema 设置或更新属性。使用以下语法：

```SQL
ALTER SCHEMA schema_name SET PROPERTIES (key1 = 'value1', key2 = 'value2', ...);
```

### 示例

1. 为 `rc4_l` schema 设置属性 `custom_property` 为 `true`：

   ```SQL
   ALTER SCHEMA rc4_l SET PROPERTIES (custom_property = 'true');
   ```

   查看 schema 属性是否设置成功：

   ```SQL
   DESC SCHEMA rc4_l;
   ```

   预期输出结果中的 properties 部分应包含新设置的属性：

   ```
   +--------------------+-------------------------+
   |     info_name      |       info_value        |
   +--------------------+-------------------------+
   | ...                 | ...                      |
   | properties          | {custom_property='true'} |
   +--------------------+-------------------------+
   ```

## 权限要求

执行 `ALTER SCHEMA` 语句的用户必须拥有对应 schema 的 ALTER 权限。如果没有相应权限，操作将被拒绝。


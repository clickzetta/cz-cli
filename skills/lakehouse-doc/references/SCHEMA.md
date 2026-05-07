# SCHEMA

在数据库设计中，SCHEMA是组织和管理数据的关键概念。它为用户提供了一种灵活的方式来定义数据的结构和关系。通过使用 SCHEMA，可以将相关的数据库对象（如表、视图等）进行逻辑分组，使得数据组织更加清晰，便于维护和扩展。

## SCHEMA的主要作用

1. **逻辑分组**：SCHEMA允许用户根据业务功能、数据类型或其他标准，将数据库对象进行逻辑分组，从而实现数据的有序组织。
2. **权限管理**：通过SCHEMA，可以对数据库对象实施更精细的权限控制。用户可以针对不同的SCHEMA设置相应的访问权限，以实现安全管理。
3. **命名空间**：SCHEMA 提供了命名空间功能，有助于避免对象名称的冲突。在大型项目或多用户环境中，这一点尤为重要。
4. **简化操作**：用户可以通过 `USE` 命令快速切换当前操作的 SCHEMA，简化了日常数据库操作，提高了工作效率。

## SCHEMA管理命令

云器 Lakehouse 提供了一系列的命令来管理 SCHEMA，包括创建、删除、查看详情、切换以及列举等。

* [创建SCHEMA](CREATESCHEMA.md)：使用 `CREATE SCHEMA` 命令可以创建一个新的 SCHEMA。例如，`CREATE SCHEMA myschema;` 会创建一个名为 `myschema` 的 SCHEMA。
* [删除SCHEMA](DROPSCHEMA.md)：如果某个 SCHEMA 不再需要，可以使用 `DROP SCHEMA` 命令将其删除。执行删除操作前，请确保已对相关数据进行备份或迁移，以防止数据丢失。
* [查看SCHEMA详情](DESCSCHEMAS.md)：通过 `DESC SCHEMAS` 命令，用户可以查看当前空间中所有 SCHEMA 的详细信息，包括创建时间、对象数量等。
* [切换SCHEMA](USESCHEMA.md)：使用 `USE SCHEMA` 命令可以切换当前会话的默认 SCHEMA。例如，`USE SCHEMA myschema;` 会将 `myschema` 设置为当前会话的默认 SCHEMA。
* [列举当前空间所有SCHEMA](show-schemas.md)：通过 `SHOW SCHEMAS` 命令，用户可以列举出当前空间中所有的 SCHEMA，便于管理和选择。
* [修改SCHEMA](<ALTER-SCHEMA.md>)：支持修改 SCHEMA 的属性和重命名 SCHEMA。

## 应用示例

以下是一个应用示例，展示了如何创建和切换 SCHEMA：

```sql
-- 创建一个新的SCHEMA
CREATE SCHEMA myschema;

-- 在创建表时指定SCHEMA
CREATE TABLE myschema.mytable (
    id INT PRIMARY KEY,
    name VARCHAR(50)
);

-- 切换到刚刚创建的SCHEMA
USE SCHEMA myschema;

-- 在当前SCHEMA下查询表结构
DESC TABLE mytable;

-- 向表中插入数据
INSERT INTO myschema.mytable (id, name) VALUES (1, '张三');

-- 查询表中的数据
SELECT * FROM myschema.mytable;
```

## 功能
删除同义词
## 语法

```SQL
DROP [TABLE|VOLUME|FUNCTION] SYNONYM [ IF EXISTS ] [ schema. ] synonym_name
```

* TABLE|VOLUME|FUNCTION：表示给哪种对象命名同义词。

  * **TABLE**：这是默认选项。用于为table、table stream、materialized view、dynamic table命名同义词。在这些情况下，“TABLE”关键字是可选的。
  * **VOLUME**：为VOLUME命名同义词时，必须明确指定此关键字。如果省略，系统将默认寻找同名的TABLE对象。
  * **FUNCTION**：为FUNCTION命名同义词时，此关键字是必填项。如果未指定，系统同样会默认寻找同名的TABLE对象。

* `IF EXISTS`：可选。仅当同义词已存在时，才有条件地删除该同义词。

* `schema`：可选。指定同义词所在的schema。如果未指定schema，则使用当前会话的默认schema。

### 权限

```SQL
grant drop synonym on all synonyms in schema <schemaname> to user uat_test_01;
```
## 示例
为TABLE创建同义词并删除
```SQL
CREATE TABLE employees(id int,name string,skills array<string>);
INSERT INTO employees (id, name, skills) VALUES
(1, 'John Doe', ['Java', 'Python', 'SQL']),
(2, 'Jane Smith', ['C++', 'Hadoop', 'SQL']),
(3, 'Bob Johnson', ['Python', 'Docker']);
CREATE TABLE SYNONYM employees_syno FOR employees;
--删除同义词
DROP SYNONYM employees_syno;
```
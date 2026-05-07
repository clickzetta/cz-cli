## 功能

创建同义词，同义词synonym是一个数据库对象，类似给对象起一个别名。支持为以下对象创建同义词：table、table stream、dynamic table、materialzied view、volume、function。

## 创建语法

```SQL
CREATE  [TABLE|VOLUME|FUNCTION] SYNONYM [schema_name.] synonym_name FOR object COMMENT''
object ::=
workspace_name.schema_name.object_name|schema_name.object_name|object_name
```

* TABLE|VOLUME|FUNCTION：表示给哪种对象命名同义词，

  * **TABLE**：这是默认选项。用于为table、table stream、materialzied view、dynamic table命名同义词。在这些情况下，“table”关键字是可选的。
  * **VOLUME**：volume命名同义词时，必须明确指定此关键字。如果省略，系统将默认寻找同名的表格对象。
  * **FUNCTION**：function命名同义词时，此关键字是必填项。如果未指定，系统同样会默认寻找同名的table对象

* synonym\_name:同义词名称，遵循元数据规范

* object：指定基对象的名称，支持workspace\_name.schema\_name\_2.object\_name、schema\_name\_2.name格式如果省略schema则使用当前schema中的对象

### 权限

* 创建create synonym需要create synonym权限

```SQL
grant create synonym  on schema  scname to user uat_test_01;
```

### 使用方式

1. 具体使用方式参考[同义词使用](synonym.md)
2. 当删除同义词引用（例如 TABLE、TABLE STREAM、MATERIALIZED VIEW、DYNAMIC TABLE、VOLUME、FUNCTION 等）后，如果随后创建了与之前同名的新引用，则系统将自动指向并使用新的引用。这意味着任何对原对象的引用，在新对象创建后，都将自动适用于新对象，而无需更改现有的查询或代码。

## 使用案例

案例一：给表创建同义词

```SQL
CREATE TABLE employees(id int,name string,skills array<string>);
INSERT INTO employees (id, name, skills) VALUES
(1, 'John Doe', ['Java', 'Python', 'SQL']),
(2, 'Jane Smith', ['C++', 'Hadoop', 'SQL']),
(3, 'Bob Johnson', ['Python', 'Docker']);
CREATE TABLE SYNONYM employees_syno FOR employees;
--查询同义词
SELECT * FROM employees_syno;
+----+-------------+-------------------------+
| id |    name     |         skills          |
+----+-------------+-------------------------+
| 1  | John Doe    | ["Java","Python","SQL"] |
| 2  | Jane Smith  | ["C++","Hadoop","SQL"]  |
| 3  | Bob Johnson | ["Python","Docker"]     |
+----+-------------+-------------------------+

```

案例二：给table stream创建同义词，table stream和table创建同义词语法相同

```SQL
CREATE  SYNONYM employees_stream_synonym FOR public.employees_stream;
--删除同义词
DROP SYNONYM employees_stream_synonym;
```

案例三：给DYNAMIC TABLE创建同义词，DYNAMIC TABLE和TABLE创建同义词语法相同

```
CREATE  SYNONYM dt_synonym for public.my_dt;
--删除同义词
DROP SYNONYM dt_synonym;
```



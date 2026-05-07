## 功能

列出schema下的同义词

## 语法

```SQL
SHOW SYNONYMS [IN SCHEMA scname ] [LIKE 'pattern' | WHERE expr]  [LIMIT num]
```

1. `IN schema_name`：可选参数，用于指定 schema 名称。通过此参数，用户可以查看指定 schema 下的所有同义词。

2. `WHERE expr`：可选参数，允许用户根据 `SHOW SYNONYMS` 命令显示的字段进行筛选。此参数提供了更灵活的查询方式。

## 案例

1. 根据同义词名称过滤

```SQL
SHOW SYNONYMS WHERE     synonym_name = 'students_sy';
```

2. 查看指定 schema 下的同义词

```SQL
  SHOW SYNONYMS IN public;
```



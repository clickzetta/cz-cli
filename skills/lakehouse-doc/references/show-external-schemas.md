## 功能
本命令用于查看外部 schema 的相关信息。

## 语法

```SQL
SHOW SCHEMAS EXTENDED WHERE type='external';
```

## 参数说明

1. EXTENDED 关键字：添加此关键字后，将增加一个额外的列（type），用于区分是外部 schema（EXTERNAL SCHEMA）还是托管 schema（MANAGED SCHEMA）。

2. WHERE <expr>：支持根据 `SHOW SCHEMAS` 显示的字段进行筛选。例如，使用 `type='external'` 表示筛选出所有外部 schema。

## 使用示例

1. 查看所有 schema 的列表：

   ```SQL
   SHOW SCHEMAS;
   ```

2. 查看所有托管 schema 的列表：

   ```SQL
   SHOW SCHEMAS EXTENDED WHERE type='managed';
   ```

3. 查看所有外部 schema 的列表：

   ```SQL
   SHOW SCHEMAS EXTENDED WHERE type='external';
   ```


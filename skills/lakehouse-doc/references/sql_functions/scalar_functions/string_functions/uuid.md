### UUID 函数

#### 功能描述
`uuid()` 函数用于生成一个标准的唯一标识符（UUID）。UUID（Universally Unique Identifier）是一种用于计算机系统中确保全局唯一性的标识符标准。

#### 语法
```
uuid()
```

#### 参数
无

#### 返回结果
返回一个字符串类型的 UUID。

#### 使用示例
1. 生成一个 UUID 并显示结果：
```sql
SELECT uuid();
```
执行结果可能如下：
```
4d275467-77ee-427f-9d4e-f55078c6b4df
```


2. 用于更新记录时生成一个关联的新 UUID：
```sql
UPDATE example_table SET related_id = uuid() WHERE id = 'existing_id';
```
这将为 `example_table` 表中具有指定 `existing_id` 的记录生成一个新的 `related_id`。


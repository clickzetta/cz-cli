# 功能
列出指定表的所有索引

# 语法
```
SHOW INDEX [IN|FROM] [schema].table_name  [LIMIT num];
```

# 使用示例

1. 查询名为 `users` 的表在默认数据库中的布隆过滤器索引：

```
SHOW INDEX FROM users;
```

2. 查询名为 `orders` 的表在名为 `my_schema` 的数据库中的布隆过滤器索引：

```
SHOW INDEX FROM my_schema.orders;
```


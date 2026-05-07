## 功能

`uuid()` 函数用于生成一个全局唯一标识符（UUID），该标识符是一个符合通行标准的、长度为 36 个字符的字符串。UUID 是一种广泛应用于分布式系统的标识方法，可以保证在不同系统、不同时间生成的 UUID 值是唯一的。

## 语法

```
uuid()
```

## 返回值

该函数返回一个字符串类型的 UUID，格式为 `8-4-4-4-12`，例如：`123e4567-e89b-12d3-a456-426614174000`。

## 使用示例

以下是一些使用 `uuid()` 函数的示例：

1. 生成一个 UUID 并将其作为新记录的 ID：

   ```SQL
   INSERT INTO users (id, username, email) VALUES (uuid(), 'john_doe', 'john@example.com');
   ```

2. 在查询中使用 UUID 作为某个唯一标识：

   ```SQL
   SELECT * FROM products WHERE id = 'a1b2c3d4-5678-90ab-cdef-1234567890ab';
   ```

3. 为每个订单生成一个唯一的追踪码：

   ```SQL
   UPDATE orders SET tracking_number = uuid() WHERE status = 'pending';
   ```

4. 在创建新的日志记录时，使用 UUID 作为日志的唯一标识：

   ```SQL
   INSERT INTO logs (log_id, user_id, action, timestamp) VALUES (uuid(), 123, 'login', NOW());
   ```

## 注意事项

- UUID 值的生成依赖于特定的算法，因此不同的数据库系统可能会生成不同格式的 UUID。
- 在使用 UUID 作为数据库表的主键时，需要注意其性能影响，因为 UUID 的生成通常是随机的，可能会导致数据在存储（如索引）上分布不均。
- UUID 虽然具有极高的唯一性，但在某些场景下，例如需要有序处理的业务逻辑中，可能不适用。

# 删除索引

## 简介
删除索引。

## 语法
```
DROP INDEX [IF EXISTS] index_name;
```

## 参数说明
- `DROP INDEX`：删除索引的关键字。
- `IF EXISTS`：可选参数，如果指定的索引不存在，则不报错。
- `index_name`：要删除的索引名称。

## 使用示例

示例1：删除名为 `bf_index` 的索引
```
DROP INDEX bf_index;
```

示例2：删除名为 `bf_index` 的索引，如果不存在则不报错。
```
DROP INDEX IF EXISTS bf_index;
```

## 注意事项
- 删除索引并不会立即释放索引所占用的存储空间。后续新增的数据将不会为该索引构建索引数据。

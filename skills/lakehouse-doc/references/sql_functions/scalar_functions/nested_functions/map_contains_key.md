### MAP_CONTAINS_KEY 函数

#### 功能描述
MAP_CONTAINS_KEY 函数用于判断给定的 map 类型数据中是否包含指定的键（key）。当指定的键存在于 map 中时，函数返回 true；否则返回 false。

#### 语法
```
MAP_CONTAINS_KEY(map: map<K, V>, key: K): boolean
```

#### 参数
- map: 待检查的 map 类型数据，其中 K 表示键的类型，V 表示值的类型。
- key: 需要查询的键，其类型应与 map 中的键类型 K 相匹配。

#### 返回值
返回一个布尔值，表示 map 中是否包含指定的键。

#### 使用示例
1.  判断 map 中是否包含键 'a'：
    ```sql
SELECT MAP_CONTAINS_KEY(map('a', 1), 'a'); -- 返回 true
```
2.  判断 map 中是否包含键 'b'：
    ```sql
SELECT MAP_CONTAINS_KEY(map('a', 1), 'b'); -- 返回 false
```
3.  假设有一个 map 类型的数据，包含键值对 ('name', 'Alice') 和 ('age', 25)，判断 map 中是否包含键 'name'：
    ```sql
SELECT MAP_CONTAINS_KEY(map('name', 'Alice', 'age', 25), 'name'); -- 返回 true
```
4.  判断上述 map 中是否包含键 'gender'：
    ```sql
SELECT MAP_CONTAINS_KEY(map('name', 'Alice', 'age', 25), 'gender'); -- 返回 false
```
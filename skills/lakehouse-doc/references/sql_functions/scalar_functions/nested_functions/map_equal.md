### MAP_EQUAL 函数

#### 功能描述
MAP_EQUAL 函数用于比较两个 Map 类型的数据结构（以下简称 Map），判断它们是否完全相同。如果两个 Map 的键值对完全一致，则函数返回 true；否则，返回 false。

#### 语法
```
MAP_EQUAL(m1, m2)
```
其中，`m1` 和 `m2` 分别表示需要比较的两个 Map。

#### 参数说明
- `m1`, `m2`: 需要比较的两个 Map。

#### 返回结果
返回一个布尔值（boolean）。如果两个 Map 完全相同，则返回 true；否则，返回 false。

#### 使用示例
1. 比较两个完全相同的 Map：
   ```
   SELECT MAP_EQUAL(MAP('k1', 'v1', 'k2', 'v2'), MAP('k1', 'v1', 'k2', 'v2'));
   → true
   ```
2. 比较两个不同的 Map（键值对不一致）：
   ```
   SELECT MAP_EQUAL(MAP('k1', 'v1', 'k2', 'v2'), MAP('k1', 'v3', 'k2', 'v4'));
   → false
   ```
3. 比较两个不同的 Map（键不一致）：
   ```
   SELECT MAP_EQUAL(MAP('k1', 'v1', 'k3', 'v3'), MAP('k2', 'v2', 'k3', 'v3'));
   → false
   ```

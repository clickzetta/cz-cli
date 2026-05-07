### MAP_EXCEPT 函数

#### 功能描述
MAP_EXCEPT 函数用于从第一个映射（map1）中移除与第二个映射（map2）中相同的键值对（K, V）。该函数在数据清洗和转换中非常有用，可以帮助用户快速过滤掉不需要的重复数据。

#### 参数说明
* map1, map2: `map<K, V>` 类型，分别代表第一个和第二个映射。

#### 返回结果
返回一个新的映射（map<K, V>），其中包含了从第一个映射中移除与第二个映射相同的键值对后的结果。

#### 使用示例
1. 过滤重复的键值对
```sql
SELECT MAP_EXCEPT(MAP(1, 'apple', 2, 'orange'), MAP(1, 'apple', 3, 'banana'));
-- 返回结果：{2:'orange'}
```
在这个示例中，MAP_EXCEPT 函数从第一个映射中移除了与第二个映射相同的键值对（1, 'apple'）。

2. 保留唯一的键值对
```sql
SELECT MAP_EXCEPT(MAP(1, 'apple', 2, 'orange', 3, 'banana'), MAP(2, 'orange', 4, 'grape'));
-- 返回结果：{1:'apple', 3:'banana'}
```
在这个示例中，MAP_EXCEPT 函数从第一个映射中移除了与第二个映射相同的键值对（2, 'orange'），同时保留了其他唯一的键值对。

3. 处理 NULL 值
```sql
SELECT MAP_EXCEPT(MAP(1, NULL, 2, 'pear'), MAP(1, NULL));
-- 返回结果：{2:'pear'}
```
在这个示例中，MAP_EXCEPT 函数从第一个映射中移除了与第二个映射相同的键值对（1, NULL），同时保留了其他唯一的键值对。

通过以上示例，您可以看到 MAP_EXCEPT 函数在处理映射数据时的灵活性和实用性。您可以根据自己的需求，灵活地应用该函数进行数据过滤和转换。
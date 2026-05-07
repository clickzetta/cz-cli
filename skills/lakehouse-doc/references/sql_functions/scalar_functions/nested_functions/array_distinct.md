### 数组去重函数：ARRAY_DISTINCT

#### 功能描述
`ARRAY_DISTINCT` 函数用于去除数组中的重复元素，返回一个不包含重复项的数组。该函数可以处理任何类型的数组，包括整数、浮点数、字符串等。

#### 语法
```
ARRAY_DISTINCT(array)
```

#### 参数说明
- `array`：`array<T>` 类型，表示需要去重的数组。

#### 返回结果
返回一个 `array<T>` 类型的数组，其中包含了去重后的数组元素。

#### 使用示例
1.  去除整数数组中的重复项：
    ```sql
   SELECT ARRAY_DISTINCT(ARRAY(1, 2, 2, 3));
   -- 返回结果：[1, 2, 3]
   ```

2.  去除浮点数数组中的重复项：
    ```sql
   SELECT ARRAY_DISTINCT(ARRAY(3.14, 2.71, 2.71, 1.41));
   -- 返回结果：[3.14, 2.71, 1.41]
   ```

3.  去除字符串数组中的重复项：
    ```sql
   SELECT ARRAY_DISTINCT(ARRAY('apple', 'orange', 'apple', 'banana'));
   -- 返回结果：['apple', 'orange', 'banana']
   ```

4.  去除混合类型数组中的重复项：
    ```sql
   SELECT ARRAY_DISTINCT(ARRAY(1, 'a', 2, 'b', 1, 'a', 3));
   -- 返回结果：[1,null,2,3]
   ```
   
#### 注意事项
- 当数组为空时，`ARRAY_DISTINCT` 函数将返回一个空数组。

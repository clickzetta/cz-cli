### 数组大小函数：ARRAY_SIZE

#### 功能描述
`ARRAY_SIZE` 函数用于获取数组中元素的数量，即数组的大小。该函数可以处理包括数字、字符串、布尔值等在内的各种数据类型的数组。

#### 语法
```
ARRAY_SIZE(array)
```
#### 参数说明
* `array`: `array<T>` 类型，表示待计算大小的数组。

#### 返回类型
* 返回一个整数，表示数组中元素的数量。

#### 使用示例
1.  计算数字数组的大小：
    ```sql
SELECT ARRAY_SIZE(array(1, 2, 3, 4, 5));
-- 返回结果：5
```
2.  计算字符串数组的大小：
    ```sql
SELECT ARRAY_SIZE(array('apple', 'banana', 'cherry'));
-- 返回结果：3
```
3.  计算包含布尔值的数组的大小：
    ```sql
SELECT ARRAY_SIZE(array(true, false, true, false, true));
-- 返回结果：5
```


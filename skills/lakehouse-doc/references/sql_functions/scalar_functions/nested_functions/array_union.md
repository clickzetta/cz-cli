### 数组并集函数：ARRAY_UNION

```
array_union(array1, array2)
```

#### 功能描述
ARRAY_UNION 函数用于计算两个数组的并集，即合并 array1 和 array2 中的所有元素，并去除重复项。该函数能够处理包含多种数据类型的数组，例如整数、浮点数、字符串等。

#### 参数说明
- `array1`: `array<T>` 类型，表示第一个输入数组。
- `array2`: `array<T>` 类型，表示第二个输入数组。

#### 返回结果
返回一个新的数组，包含 array1 和 array2 中的所有不重复元素。

#### 使用示例
1.  求两个整数数组的并集：
    ```sql
SELECT array_union(array(2, 1, 3, 3), array(3, 5));
-- 返回结果：[2, 1, 3, 5]
```
2.  求两个字符串数组的并集：
    ```sql
SELECT array_union(array('apple', 'orange', 'banana'), array('banana', 'grape', 'apple'));
-- 返回结果：['apple', 'orange', 'banana', 'grape']
```
3.  求两个浮点数数组的并集：
    ```sql
SELECT array_union(array(1.2, 2.5, 3.7), array(3.7, 4.6, 5.3));
-- 返回结果：[1.2, 2.5, 3.7, 4.6, 5.3]
```


#### 注意事项
- 如果输入的数组为空，ARRAY_UNION 函数将返回一个空数组。

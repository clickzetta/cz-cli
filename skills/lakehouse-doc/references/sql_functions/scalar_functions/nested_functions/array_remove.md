### 数组移除函数：ARRAY_REMOVE

#### 功能描述
`ARRAY_REMOVE` 函数用于从给定的数组 `array` 中移除所有与指定元素 `element` 相等的项。该函数接受两个参数：第一个参数为待操作的数组，第二个参数为需要移除的元素。执行后，返回一个新的数组，其中不包含与指定元素相等的项。

#### 参数说明
- `array`: `array<T>` 类型，表示待操作的数组。
- `element`: T 类型，表示需要从数组中移除的元素。

#### 返回结果
返回一个新的 `array<T>` 类型数组，其中不包含与指定元素 `element` 相等的项。

#### 使用示例
1.  从包含整数的数组中移除元素 `1`：
    ```sql
SELECT array_remove(array(1, 2, 3), 1);
```
    返回结果：
    ```
[2, 3]
```

2.  从包含字符串的数组中移除元素 `"apple"`：
    ```sql
SELECT array_remove(array("apple", "banana", "cherry", "apple"), "apple");
```
    返回结果：
    ```
["banana", "cherry"]
```



通过以上示例，您可以看到 `ARRAY_REMOVE` 函数在不同场景下的应用。该函数可以方便地用于处理数组数据，满足您在数据清洗、筛选等方面的需求。
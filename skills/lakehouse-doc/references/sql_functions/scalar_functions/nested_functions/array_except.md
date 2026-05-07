### 数组差分函数：ARRAY_EXCEPT

```
array_except(array1, array2)
```

#### 功能描述
ARRAY_EXCEPT 函数用于计算两个数组之间的差异，即找出仅存在于第一个数组（array1）中的元素，并将结果中的重复元素去除。该函数在处理集合操作时非常有用，可以帮助用户快速找出两个数组的不同之处。

#### 参数说明
- array1: `array<T>` 类型，表示第一个输入数组。
- array2: `array<T>` 类型，表示第二个输入数组。

#### 返回结果
返回一个 `array<T>` 类型的数组，其中包含仅存在于第一个数组中的元素，且结果中不包含重复元素。

#### 使用示例
1. 求两个整数数组的差异：
```sql
SELECT array_except(array(1, 2, 3, 4, 5), array(3, 4, 6, 7));
```
结果：
```
[1, 2, 5]
```
2. 求两个字符串数组的差异：
```sql
SELECT array_except(array('apple', 'banana', 'orange'), array('banana', 'grape', 'orange'));
```
结果：
```
['apple']
```

通过以上示例可以看出，ARRAY_EXCEPT 函数在处理数组差异时非常有效。用户可以根据需求，灵活运用该函数进行集合操作。
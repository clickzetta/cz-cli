# 数组位置查找函数：ARRAY\_POSITION

## 功能描述

`array_position` 函数用于在一个给定的数组 `array` 中查找元素 `element` 的位置。如果找到该元素，函数返回其在数组中的起始位置（位置计数从1开始）；如果未找到该元素，则返回0。

## 参数说明

* `array`: `array<T>` 类型，表示待查找的数组。
* `element`: T 类型，表示要查找的元素。

## 返回值

* 返回一个整数，表示元素在数组中的位置（从1开始计数），如果元素不存在，则返回0。

## 使用示例

以下是一些使用 `array_position` 函数的示例：

1. 查找数字1在数组 `(1, 2, 3)` 中的位置：
   ```sql
   SELECT array_position(array(1, 2, 3), 1);
   -- 结果：1
   ```

2. 查找数字4在数组 `(1, 2, 3)` 中的位置，预期结果为0（因为4不存在于该数组中）：
   ```sql
   SELECT array_position(array(1, 2, 3), 4);
   -- 结果：0
   ```

3. 在一个包含字符串的数组中查找元素 "apple"：
   ```sql
   SELECT array_position(array('banana', 'apple', 'cherry'), 'apple');
   -- 结果：2
   ```

4. 尝试在一个空数组中查找元素 "orange"，预期结果为0：
   ```sql
   SELECT array_position(array(), 'orange');
   -- 结果：0
   ```

5. 查找数字3在一个包含重复元素的数组 `(1, 2, 3, 3)` 中的位置：
   ```sql
   SELECT array_position(array(1, 2, 3, 3), 3);
   -- 结果：3
   ```



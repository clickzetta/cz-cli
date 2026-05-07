### 函数名称：CARDINALITY

#### 功能描述
`CARDINALITY` 函数用于计算数组中元素的数量或映射中键值对的数量。

#### 语法
```
CARDINALITY(array)
CARDINALITY(map)
```

#### 参数说明
- `array`: 输入的数组，元素类型为 `T`。
- `map`: 输入的映射，由键类型 `K` 和值类型 `V` 组成。

#### 返回类型
- 返回一个整型数值（`int`），表示数组中元素的个数或映射中键值对的个数。

#### 使用示例
1.  计算数组中元素的个数：
    ```
SELECT CARDINALITY(ARRAY(1, 2, 3, 4, 5)); -- 返回 5
```
2.  计算映射中键值对的个数：
    ```
SELECT CARDINALITY(MAP("a", 1, "b", 2, "c", 3)); -- 返回 3
```
3.  结合实际数据表进行操作：
    假设有一个名为 `students` 的数据表，表结构如下：
    ```
CREATE TABLE students (
  id INT,
  name VARCHAR,
  hobbies ARRAY<VARCHAR>
);
```
    向 `students` 表中插入一条数据：
    ```
INSERT INTO students (id, name, hobbies) VALUES (1, 'Alice', ARRAY('reading', 'swimming', 'traveling'));
```
    使用 `CARDINALITY` 函数计算该学生的爱好数量：
    ```
SELECT CARDINALITY(hobbies) FROM students WHERE id = 1; -- 返回 3
```


### BITMAP_SUBSET_IN_RANGE 函数

#### 功能描述
BITMAP_SUBSET_IN_RANGE 函数用于从给定的 bitmap 类型数据中提取一个指定范围的子集。该函数根据 `range_start`（范围起始值）和 `cardinality_limit`（范围大小限制）两个参数来确定子集的具体内容。目前，该函数仅支持 int 类型的数值。

#### 参数说明
* bitmap: 输入的 bitmap 类型数据。
* range_start: int 类型，表示范围的起始值。
* cardinality_limit: int 类型，表示范围的大小限制。

#### 返回结果
返回一个 bitmap 类型数据，包含指定范围内的元素。

#### 使用示例
以下示例展示了如何使用 BITMAP_SUBSET_IN_RANGE 函数来提取 bitmap 数据的子集：

1. 提取从第二个元素开始、由两个元素组成的子集：
```sql
SELECT BITMAP_SUBSET_IN_RANGE(bitmap_build(array(2, 1, 3)), 1, 2);
```
结果：
```
[1]
```

2. 将提取的子集转换为数组形式：
```sql
SELECT BITMAP_TO_ARRAY(BITMAP_SUBSET_IN_RANGE(bitmap_build(array(2, 1, 3)), 1, 2));
```
结果：
```
[ 1]
```


通过以上示例，您可以看到 BITMAP_SUBSET_IN_RANGE 函数在不同场景下的应用。该函数可以帮助您更方便地处理和分析 bitmap 类型数据。
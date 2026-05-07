# Bitmap 类型说明

Bitmap（位图）是云器 Lakehouse 中用于存储和处理集合类型数据的高效数据类型。云器 Lakehouse 中的 Bitmap 是 **64 位的**，使用 Roaring Bitmap 压缩算法进行优化，能够高效地存储和处理大规模的整数集合。

Bitmap 通过位级操作来表示整数集合，提供极高的空间压缩率。相比于直接存储数组，Bitmap 能够显著降低存储成本，同时提供快速的集合操作性能。

### Bitmap 的特点

* **64 位整数支持**：支持存储 0 到 2^64-1 范围内的整数
* **高效压缩**：使用 Roaring Bitmap 算法，空间占用极小
* **快速运算**：支持并集、交集、补集等集合操作，性能优异
* **二进制序列化**：可与 binary 类型相互转换，方便数据交换
* **灵活查询**：支持集合包含检查、基数计算等操作

## 语法

### 创建包含 Bitmap 列的表

```SQL
CREATE TABLE table_name (
    column_name bitmap
);
```

**示例**：

```SQL
CREATE TABLE bitmap_example (
    user_id bigint,
    preference_tags bitmap
);
```

### 构建 Bitmap 数据

#### 使用 bitmap\_build 函数

从整数数组构建 Bitmap 对象：

```SQL
bitmap_build(array_expression)
```

**示例**：

```SQL
INSERT INTO bitmap_example VALUES
    (1, bitmap_build(array(1, 3, 5, 7, 9))),
    (2, bitmap_build(array(2, 4, 6, 8, 10)));
```

#### 使用 GROUP\_BITMAP\_STATE 函数

根据输入的表达式（expr）构建一个 bitmap 类型的结果，函数通常用于对整数类型的数据进行分组操作，并将每个分组的唯一值转换为一个 bitmap 数组。

```SQL
GROUP_BITMAP_STATE(expr)
```

**示例**：

```SQL
INSERT INTO bitmap_example
SELECT user_id, group_bitmap_state(v) AS bitmap_array
FROM VALUES (1, 1), (1, 2), (1, 2), (2, 3) AS v(user_id, v)
GROUP BY user_id;
```

## 注意事项

### 功能限制

1. **不支持比较操作**：Bitmap 类型不支持直接的比较操作（<、>、=、!=等）
2. **不支持排序和分组**：Bitmap 列不能用于 ORDER BY、GROUP BY 或 DISTINCT 操作
3. **不支持作为键**：Bitmap 不能作为表的 PRIMARY KEY、PARTITION KEY 或 CLUSTER KEY
4. **查询屏显示**：clickzetta-java 的版本是 >3.0.21

### 数据有效性

1. **有效的整数范围**：bitmap\_build 函数的输入数组必须包含有效的整数值
2. **Binary 转换**：使用 binary\_to\_bitmap 进行转换时，输入的 binary 数据使用bitmap\_to\_binary转化必须是有效的 Bitmap 序列化格式
3. **空值处理**：Bitmap 本身可以是 NULL，但数组中的 NULL 值会被忽略

### 性能考虑

1. **适用场景**：Bitmap 最适合存储稀疏的整数集合或大整数集合
2. **集合运算**：大规模的集合运算应在数据库层完成，而不是在应用层处理

## 常见 Bitmap 函数
更多Bitmap函数参考[Bitmap文档](<sql_functions/scalar_functions/bitmap_functions/bitmap_to_binary.md>)
### 数据构造函数

**bitmap\_build**

从整数数组构建 Bitmap 对象。

```SQL
bitmap_build(array<integer>)
```


| 参数  | 说明                 |
| ----- | -------------------- |
| array | 包含整数的数组表达式 |

**返回值**： bitmap

***

**bitmap\_empty**

返回一个空的 Bitmap 对象。

```SQL
bitmap_empty()
```

| 参数   | 说明                          |
| ------ | ----------------------------- |
| 无参数 | 返回不包含任何元素的空 bitmap |

**返回值**： bitmap

***

**to\_bitmap**

将整数或字符串转换为包含单个元素的 Bitmap。

```SQL
to_bitmap(expr)
```

| 参数 | 说明                         |
| ---- | ---------------------------- |
| expr | 整数类型或字符串类型的表达式 |

**返回值**： bitmap

**注意**：如果输入为 null 或负数，返回 NULL

***

**string\_to\_bitmap**

将逗号分隔的字符串转换为 Bitmap 对象。

```SQL
string_to_bitmap(str)
```

| 参数 | 说明                 |
| ---- | -------------------- |
| str  | 逗号分隔的整数字符串 |

**返回值**： bitmap

**注意**：如果字符串包含负数或格式不正确，返回 NULL

***

### 数据转换函数

**bitmap\_to\_array**

将 Bitmap 转换为整数数组。

```SQL
bitmap_to_array(bitmap)
```

**返回值**： array\<integer>

***

**bitmap\_to\_binary**

将 Bitmap 转换为 binary 类型。

```SQL
bitmap_to_binary(bitmap)
```

**返回值**： binary

***

**binary\_to\_bitmap**

将 binary 类型转换为 Bitmap。

```SQL
binary_to_bitmap(binary)
```

**返回值**： bitmap

***

### 集合运算函数

**bitmap\_and**

计算两个 Bitmap 的交集（与操作）。

```SQL
bitmap_and(bitmap1, bitmap2)
```

**返回值**： bitmap

***

**bitmap\_or**

计算两个 Bitmap 的并集（或操作）。

```SQL
bitmap_or(bitmap1, bitmap2)
```

**返回值**： bitmap

***

**bitmap\_xor**

计算两个 Bitmap 的异或集（异或操作）。

```SQL
bitmap_xor(bitmap1, bitmap2)
```

**返回值**： bitmap

***

### 统计函数

**bitmap\_cardinality**

计算 Bitmap 中元素的个数（基数）。

```SQL
bitmap_cardinality(bitmap)
```

**返回值**： bigint

***

### 查询函数

**bitmap\_contains**

检查 Bitmap 中是否包含指定的整数。

```SQL
bitmap_contains(bitmap, element)
```

|         |                |
| ------- | -------------- |
| 参数    | 说明           |
| bitmap  | Bitmap 对象    |
| element | 要检查的整数值 |

**返回值**： boolean

***

## 案例

**案例 1：创建表并插入数据**

```SQL
CREATE TABLE bitmap_example (
    user_id bigint,
    preference_tags bitmap
);

INSERT INTO bitmap_example VALUES
    (1, bitmap_build(array(1, 3, 5, 7, 9))),
    (2, bitmap_build(array(2, 4, 6, 8, 10))),
    (3, bitmap_build(array(1, 2, 3, 4, 5))),
    (4, bitmap_build(array(5, 6, 7, 8, 9, 10)));
```

**案例 2：查询 Bitmap 中的元素**

```SQL
SELECT
    user_id,
    bitmap_to_array(preference_tags) AS tags
FROM bitmap_example;
```

**执行结果**：

|          |                      |
| -------- | -------------------- |
| user\_id | tags                 |
| 1        | \[1, 3, 5, 7, 9]     |
| 2        | \[2, 4, 6, 8, 10]    |
| 3        | \[1, 2, 3, 4, 5]     |
| 4        | \[5, 6, 7, 8, 9, 10] |

**案例 3：计算 Bitmap 基数（元素个数**）

```SQL
SELECT
    user_id,
    bitmap_cardinality(preference_tags) AS tag_count
FROM bitmap_example;
```

**执行结果**：


| user\_id | tag\_count |
| -------- | ---------- |
| 1        | 5          |
| 2        | 5          |
| 3        | 5          |
| 4        | 6          |

**案例 4：检查 Bitmap 中是否包含特定元素**

**SQL 执行**：

```SQL
SELECT
    user_id,
    bitmap_to_array(preference_tags) AS my_tags,
    bitmap_contains(preference_tags, 5) AS has_tag_5
FROM bitmap_example;
```

**执行结果**：



| user\_id | my\_tags             | has\_tag\_5 |
| -------- | -------------------- | ----------- |
| 1        | \[1, 3, 5, 7, 9]     | TRUE        |
| 2        | \[2, 4, 6, 8, 10]    | FALSE       |
| 3        | \[1, 2, 3, 4, 5]     | TRUE        |
| 4        | \[5, 6, 7, 8, 9, 10] | TRUE        |

**案例 5：计算两个用户的共同标签（交集**）

SQL 执行：

```SQL
SELECT
    bitmap_to_array(
        bitmap_and(
            (SELECT preference_tags FROM bitmap_example WHERE user_id = 1),
            (SELECT preference_tags FROM bitmap_example WHERE user_id = 3)
        )
    ) AS common_tags;
```

执行结果：

|              |
| ------------ |
| common\_tags |
| \[1, 3, 5]   |

**案例 6：计算两个用户的所有标签（并集**）

SQL 执行：

```SQL
SELECT
    bitmap_to_array(
        bitmap_or(
            (SELECT preference_tags FROM bitmap_example WHERE user_id = 1),
            (SELECT preference_tags FROM bitmap_example WHERE user_id = 2)
        )
    ) AS union_tags;
```

执行结果：


| union\_tags                      |
| -------------------------------- |
| \[1, 3, 5, 7, 9, 2, 4, 6, 8, 10] |

**案例 7：Bitmap 与 Binary 的转换**

SQL 执行：

```SQL
SELECT
    user_id,
    bitmap_to_array(preference_tags) AS original_tags,
    bitmap_to_array(binary_to_bitmap(bitmap_to_binary(preference_tags))) AS restored_tags
FROM bitmap_example;
```

执行结果：


| user\_id | original\_tags       | restored\_tags       |
| -------- | -------------------- | -------------------- |
| 1        | \[1, 3, 5, 7, 9]     | \[1, 3, 5, 7, 9]     |
| 2        | \[2, 4, 6, 8, 10]    | \[2, 4, 6, 8, 10]    |
| 3        | \[1, 2, 3, 4, 5]     | \[1, 2, 3, 4, 5]     |
| 4        | \[5, 6, 7, 8, 9, 10] | \[5, 6, 7, 8, 9, 10] |

**案例 8：使用 string\_to\_bitmap 从字符串构建 Bitmap**

SQL 执行：

```SQL
SELECT
    bitmap_to_array(string_to_bitmap('1,3,5,7,9')) AS tags_from_string,
    bitmap_cardinality(string_to_bitmap('1,3,5,7,9')) AS count;
```

执行结果：

|| tags\_from\_string | count |
|| ------------------ | ----- |
|| \[1, 3, 5, 7, 9]   | 5     |

**案例 9：使用 to\_bitmap 创建单元素 Bitmap**

SQL 执行：

```SQL
SELECT
    bitmap_to_array(to_bitmap(100)) AS single_element,
    bitmap_cardinality(to_bitmap(100)) AS count;
```

执行结果：

|| single\_element | count |
|| --------------- | ----- |
|| \[100]          | 1     |

**案例 10：使用 bitmap\_empty 创建空 Bitmap**

SQL 执行：

```SQL
SELECT
    bitmap_to_array(bitmap_empty()) AS empty_bitmap,
    bitmap_cardinality(bitmap_empty()) AS count;
```

执行结果：

|| empty\_bitmap | count |
|| ------------- | ----- |
|| \[]           | 0     |

## 使用 SDK 方式写入 Bitmap 数据

### Java SDK 示例

使用 ClickZetta Java SDK 中的 BulkloadStream 来批量写入 Bitmap 数据。需要使用 `RoaringBitmap` 构建 Bitmap 对象。

**构建bitmap对象**：

```Java
import org.roaringbitmap.longlong.Roaring64NavigableMap;
Roaring64NavigableMap roaring64Bitmap = new Roaring64NavigableMap();
roaring64Bitmap.add(1);
roaring64Bitmap.add(3);
roaring64Bitmap.add(5);
roaring64Bitmap.add(7);
row.setValue("preference_tags", roaring64Bitmap);
```

**Maven 依赖**

在 `pom.xml` 中添加以下依赖要求版本大于3.0.23：

```XML
<dependency>
    <groupId>com.clickzetta</groupId>
    <artifactId>clickzetta-java</artifactId>
    <version>${version}</version>
</dependency>
```

### Python SDK 示例

**Python依赖**：

```python
pip install clickzetta clickzetta-ingestion pyroaring
```

**构建bitmap对象**：

```python
tags = [i for i in range(1, 21, 2)]
bitmap = pyroaring.BitMap64(tags)
row.set_value('preference_tags', bitmap)
```

## 最佳实践

1. **选择合适的数据类型**：当需要存储整数集合时，优先考虑 Bitmap，尤其是集合较大或稀疏的场景

2. **在数据库层完成运算**：充分利用 Bitmap 的集合运算函数，在数据库层完成交集、并集等操作，减少数据传输

3. **合理使用转换函数**：

   1. 使用 `bitmap_to_array` 进行展示和调试
   2. 使用 `bitmap_to_binary` 进行持久化存储

4. **性能优化**：

   1. 对大规模数据集进行集合运算时，使用 Bitmap 而非 Array
   2. 使用 `bitmap_cardinality` 进行计数而非转换为数组后计数



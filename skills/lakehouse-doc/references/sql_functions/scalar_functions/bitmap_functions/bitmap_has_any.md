### BITMAP_HAS_ANY 函数

---

**功能描述**

BITMAP_HAS_ANY 函数用于检查左侧 bitmap（位图）是否包含右侧 bitmap 中的任意一个元素。换句话说，该函数用于判断两个 bitmap 是否存在交集。

**语法格式**

```
bitmap_has_any(left, right)
```

**参数说明**

- `left`: 第一个 bitmap 类型参数。
- `right`: 第二个 bitmap 类型参数。

**返回结果**

返回一个布尔值（boolean），如果左侧 bitmap 包含右侧 bitmap 中的任意一个元素，则返回 true；否则返回 false。

**使用示例**

1. 检查两个 bitmap 是否有交集：

```sql
SELECT bitmap_has_any(bitmap_build(array(1, 2, 3)), bitmap_build(array(2, 3)));
```

结果：

```
 true
```

2. 检查一个 bitmap 是否包含另一个 bitmap 的所有元素：

```sql
SELECT bitmap_has_any(bitmap_build(array(1, 2, 3, 4)), bitmap_build(array(3, 4)));
```

结果：

```
 false
```

3. 判断一个 bitmap 是否完全包含在另一个 bitmap 中：

```sql
SELECT bitmap_has_any(bitmap_build(array(1, 2, 3)), bitmap_build(array(1, 2, 3, 4)));
```

结果：

```
 true
```

**注意事项**

- 确保传入的参数类型正确，否则可能导致函数执行失败。
- BITMAP_HAS_ANY 函数主要用于 bitmap 类型数据的比较，对于其他数据类型可能不适用。
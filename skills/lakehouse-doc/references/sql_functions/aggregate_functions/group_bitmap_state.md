### GROUP_BITMAP_STATE 函数

#### 功能描述
`GROUP_BITMAP_STATE` 函数用于根据输入的表达式（`expr`）构建一个 `BITMAP` 类型的结果。该函数通常用于对整数类型的数据进行分组操作，并将每个分组的唯一值转换为一个 `bitmap` 数组。

#### 参数说明
- `expr`：待处理的整数类型表达式。

#### 返回类型
- 返回一个 `BITMAP` 类型的结果。

#### 使用示例
以下是一个使用 `group_bitmap_state` 函数的示例。我们有一个包含两列的数据表，分别为 `c` 和 `v`。我们希望根据 `c` 列的值进行分组，并将 `v` 列中每个分组的唯一值转换为一个 `bitmap` 数组。

```sql
SELECT c, bitmap_to_array(group_bitmap_state(v)) AS bitmap_array
FROM VALUES ('a', 1), ('a', 2), ('a', 2), ('b', 3) AS v(c, v)
GROUP BY c;
+-+--+--------------+
| c  | bitmap_array |
+----+--------------+
| a  | [1,2]        |
| b  | [3]          |
+----+--------------+
```

在这个示例中，我们可以看到 `a` 分组包含两个唯一值 1 和 2，因此返回的 `bitmap` 数组为 `[1,2]`。而 `b` 分组只包含一个唯一值 3，所以返回的 `bitmap` 数组为 `[3]`。

### 创建向量索引

**语法**

```SQL
CREATE TABLE table_name(
  columns_difinition,
  INDEX index_name (column_name) USING VECTOR  PROPERTIES(
      "property1" = "value1",
      "property2" = "value2"
  )
);
```

**columns\_difinition**：定义表的字段信息，最后一个字段必须使用逗号隔开

**INDEX**：关键字

**index\_name**：自定义index的名称

**column\_name**：需要添加索引的字段名称

**VECTOR**：关键字，表示向量索引

**COMMENT**：指定index的说明信息

**PROPERTIES**：指定向量INDEX的参数

| 参数名称                       | 可选值                                                                  | 默认值              | 备注                                         |
| -------------------------- | -------------------------------------------------------------------- | ---------------- | ------------------------------------------ |
| distance.function          | l2\_distance, cosine\_distance, jaccard\_distance, hamming\_distance | cosine\_distance | -                                          |
| scalar.type                | f32, f16, i8, b1                                                     | f32              | 向量索引中的向量元素类型，可与 vector column 不一致          |
| m                          | 建议不超过1000                                                            | 16               | HNSW算法中的最大邻居数                              |
| ef.construction            | 建议不超过5000                                                            | 128              | HNSW算法构建索引时的候选集大小                          |
| reuse.vector.column        | false/true                                                           | false            | 是否复用 vector column 的数据以节省存储空间              |
| compress.codec             | uncompressed/zstd/lz4                                                | uncompressed     | 向量索引的压缩算法；复用column时不生效                     |
| compress.level             | fatest/default/best                                                  | default          | 压缩算法级别                                     |
| compress.byte.stream.split | false/true                                                           | true             | 压缩前重排 float bit                            |
| compress.block.size        | 大于1M的整数                                                              | 16777216         | 压缩块大小                                      |
| conversion.rule            | default/as\_bits                                                     | default          | 需要把 vector(tinyint, N) 类型按位建索引时使用 as\_bits |

**向量索引标量类型与列类型**

索引元素类型 指的是 properites 中 scalar.type 指定的类型；两者类型不一致时，会执行一定的转换规则（多数情况下是 cast），当使用 b1 类型时除外。

|        |                     |                                                                                                              |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| 索引元素类型 | 支持的向量元素类型           | 备注                                                                                                           |
| b1     | tinyint, int, float | "conversion.rule" = "bits" 时，会把 vector(tinyint, N) 中的每个bit当成向量中的一个元素 "conversion.rule" = "default" 时，会将向量二值化 |
| i8     | tinyint, int, float | 向量元素类型与索引不一致时，执行 cast (注意可能会 overflow)                                                                       |
| f16    | int, float          | 向量元素类型与索引不一致时，执行 cast                                                                                        |
| f32    | int, float          | 向量元素类型与索引不一致时，执行 cast                                                                                        |

**案例**

```SQL
CREATE TABLE test_vector1 (
    vec vector(float, 4),
    id int,
    index test_vector1_vec_idx  (vec) using vector properties (
        "scalar.type" = "f32",
        "distance.function" = "l2_distance"
    )
)
```

## 参考文档

* [构建索引](build-inverted-index.md)
* [删除索引](DROP-INDEX.md)
* [列出所有索引](SHOW-INDEX.md)
* [查看索引详情](DESC-INDEX.md)

## 使用说明

[向量索引使用说明](vector-search.md)

### 已有的表增加向量索引

**语法**

```SQL
CREATE  VECTOR INDEX [IF NOT EXISTS] index_name ON TABLE 
[schema].table_name(col_name) PROPERTIES(
    "property1" = "value1",
    "property2" = "value2"
)
```

**VECTOR**:索引类型，向量索引

**index\_name**: 表名字，位于schema下，schema下索引名称不能重复

**PROPERTIES**：指定INDEX的参数

**说明**

执行CREATE INDEX仅对新增数据有效

**案例**

```SQL
CREATE TABLE test_vector2 (
    vec vector(float, 512),
    id int
) ;

 CREATE VECTOR INDEX test_vector2_vec_idx
 ON TABLE  test_vector2(vec) PROPERTIES (
        "scalar.type" = "f32",
        "distance.function" = "l2_distance"
 );
```

^

## 概述

Lakehouse 支持向量类型、向量搜索函数和向量索引，通过向量搜索函数可以实现向量检索场景。
向量数据类型是具有固定维度的数值有序集合。向量可以表示多种数据，例如从大型语言模型 (LLM) 获得的向量嵌入、图像或面部的向量嵌入、金融时间序列、空间坐标、速度、颜色等。使用向量数据类型可以更轻松地插入、加载和查询向量。

Lakehouse 提供了向量类型和向量索引检索功能。现代深度学习技术可以从非结构化数据（如文本和图像）中创建向量嵌入，即结构化的数值表示形式，同时保留生成向量的几何结构中的相似性和不相似性的语义概念。Lakehouse 提供了 VECTOR 类型来存储这些转化后的向量，构建索引可以提高向量搜索性能。

## Lakehouse支持的向量功能

* **向量存储**：使用 `VECTOR` 类型存储向量。
* **向量索引**：采用 HNSW（Hierarchical Navigable Small World）算法构建向量索引，以加速计算。
* **距离计算**：支持多种函数计算向量相似度，包括 `L2_DISTANCE` 和 `COSINE_DISTANCE` 等函数。

## 使用注意事项

* 当前版本的向量类型不支持比较操作，因此不能用于`ORDER BY`或`GROUP BY`子句中。
* 向量索引的性能与内存缓存、磁盘缓存直接相关，建议单独占用 VC 使用。与其他场景混合使用会相互挤占缓存，可能导致性能不如预期。

## Lakehouse向量使用

**创建向量**

```SQL

CREATE TABLE test_vector1 (
    vec vector(float, 4),
    id int,
    index test_vector1_vec_idx  (vec) using vector properties (
        "scalar.type" = "f32",
        "distance.function" = "l2_distance"
    )
);
```

properties 中支持指定的参数参考 [创建向量索引文档](create-vector-index.md)

**插入数据**

* 使用SQL插入

```SQL
INSERT INTO test_vector1 (vec, id) VALUES
    (vector(0.1, 0.2, 0.3, 0.4), 1),
    (vector(0.5, 0.6, 0.7, 0.8), 2),
    (vector(0.9, 1.0, 1.1, 1.2), 3),
    (vector(1.3, 1.4, 1.5, 1.6), 4),
    (vector(1.7, 1.8, 1.9, 2.0), 5),
    (vector(2.1, 2.2, 2.3, 2.4), 6),
    (vector(2.5, 2.6, 2.7, 2.8), 7),
    (vector(2.9, 3.0, 3.1, 3.2), 8),
    (vector(3.3, 3.4, 3.5, 3.6), 9),
    (vector(3.7, 3.8, 3.9, 4.0), 10);
```

* 如果您是通过外部系统写入到 Lakehouse 中，当前 Lakehouse 不支持直接写入 vector 类型，您可以写成 array 类型，再使用 `INSERT OVERWRITE SELECT CAST(array_col AS VECTOR)` 进行转换。

  * ```SQL
    CREATE  TABLE arraytable (vec ARRAY,id int);
    SELECT vec::VECTOR(FLOAT, 3)
    FROM arraytable;
    ```

* 如果数据在对象存储中，您可以直接使用volume导入vector类型

**向量检索**

用户可通过配置参数 `cz.vector.index.search.ef` 来调整**探索因子（ef）**，该参数用于控制在查询阶段搜索图中遍历的节点数量，从而在检索性能与准确率之间实现灵活权衡。较大的 `ef` 值通常可以提高检索的准确性，但可能增加查询延迟；较小的值则能提升检索速度，但可能牺牲部分精度。

```SQL
SET cz.vector.index.search.ef=64;
SELECT id, l2_distance(vec, vector(1,2,3,4)) AS dist FROM test_vector1 WHERE l2_distance(vec, vector(1,2,3,4)) < 4.0 ORDER BY dist LIMIT 5;
```

当需要确认向量索引是否生效时，可以使用 `\`EXPLAIN SELECT ...\`` 语法查看 TableScan 算子中是否包含 `vector_index_search_type` 字样。

```SQL
PhysicalTableSink()
  PhysicalLocalSort_L3($10)
    PhysicalShuffleRead()
      PhysicalShuffleWrite_SINGLETON()
        PhysicalLocalSort_L3($10)
          PhysicalCalc(NVL($4292967295, L2_DISTANCE($0, [1,2,3,4])), LT(_TRY_TO_FLOAT64(#0), 3.020000), $1) as [1, 10]
            PhysicalTableScan(test_vector1, LT(_TRY_TO_FLOAT64(NVL(@4292967295, L2_DISTANCE(#0, [1,2,3,4]))), 3.020000, expr_key=4292967295, limit=3, vector_index_search_type=ann), F4M:LT(_TRY_TO_FLOAT64(L2_DISTANCE(#0, [1,2,3,4])), 3.020000), GEN:[L2_DISTANCE(#0, [1,2,3,4]) as 4292967295], vec, id) as [0, 1, 4292967295]
```

当向量索引未生效时，会退化到暴力检索。

## 与倒排索引同时使用

向量索引只能解决向量检索问题，当查询带上其他字段相关的过滤条件时，会直接退化为暴力算法。为了解决这个问题，一般有两种思路。

1. 先在子查询中执行向量检索，再在外层查询中执行其他字段的过滤条件。这种方案虽然查询性能快，但如果非向量字段的过滤性比较高，最终的输出结果往往少于用户的期望数据条数，甚至为空。

```SQL
SELECT id, doc, dist FROM (
    SELECT id, doc, l2_distance(vec, vector(1,2,3,4)) as dist FROM some_table WHERE l2_distance(vec, vector(1,2,3,4)) < 1000 ORDER BY dist LIMIT 100
) WHERE doc like '%hello%';
```

2. 在常用的非向量字段上构建倒排索引，与向量检索一同使用：

```SQL
-- 建表
CREATE TABLE test_vector1 (
    vec vector(float, 4),
    index test_vector1_vec_idx  (vec) using vector properties (
        "scalar.type" = "f32",
        "distance.function" = "l2_distance"
    ),
    doc string,
    index test_vector1_doc_idx on (doc) using inverted properties ('analyzer' = 'keyword');,
    id int
) ;

-- 查询
SET cz.sql.index.prewhere.enabled=true; -- 当前需要设置开关，后续版本会默认开启
SELECT id, doc, l2_distance(vec, vector(1,2,3,4)) as dist FROM some_table WHERE match_regexp(doc, '.*hello.*', map('analyzer', 'keyword')) AND l2_distance(vec, vector(1,2,3,4)) < 1000 ORDER BY dist LIMIT 100
```

上述例子中，执行流程为：先根据 `match_regexp(doc, '.*hello.*', map('analyzer', 'keyword'))` 使用倒排索引过滤出命中的行，再从命中的行中执行向量检索。

## 向量检索查询时支持的参数

| Name                                                  | Default Value | Notes                                        |
| ----------------------------------------------------- | ------------- | -------------------------------------------- |
| Name                                                  | Default Value | Notes                                        |
| ----------------------------------------------------- | ------------- | -------------------------------------------- |
| cz.storage.parquet.vector.index.read.memory.cache     | false         | 是否使用内存缓存                                     |
| cz.storage.parquet.vector.index.read.local.cache      | false         | 是否使用本地SSD缓存                                  |
| cz.storage.parquet.vector.index.read.vectors.ondemand | adaptive      | 是否按需加载向量索引（比使用内存缓存稍慢）                        |
| cz.storage.parquet.vector.index.write.parallel        | 0             | 是否开启并行写入，0表示关闭，8表示8个线程写入。注意，性能提升比例并不与线程数成正比。 |

使用示例：在 SQL 查询时设置以下参数一起执行。

```SQL
SET cz.sql.index.prewhere.enabled=true; -- 当前需要设置开关，后续版本会默认开启
SELECT id, doc, l2_distance(vec, vector(1,2,3,4)) as dist FROM some_table WHERE match_regexp(doc, '.*hello.*', map('analyzer', 'keyword')) AND l2_distance(vec, vector(1,2,3,4)) < 1000 ORDER BY dist LIMIT 100
```

## 计费

* 存储资源：向量索引会创建向量索引文件，该文件与数据文件都保存在对象存储中，统一计费。

^

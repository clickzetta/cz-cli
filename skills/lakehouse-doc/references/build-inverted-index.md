## 构建索引

对存量数据添加索引。目前只支持向量索引和倒排索引，不支持布隆过滤器。

## 语法

```SQL
-- 语法 1，默认给全表的存量数据加上索引
BUILD INDEX index_name ON [schema].table_name;
-- 语法 2，可指定partition，可指定一个或多个,支持=, !=, >, >=, <, <=
BUILD INDEX index_name ON table_name WHERE partition_name1 = '1' and partition_name2 = '2';
```

* `index_name`：指定要添加的索引名称
* 支持指定分区构建：可以指定一个或多个分区

## 说明

执行 `BUILD INDEX` 是一个同步任务，执行过程会消耗计算资源。查看进度可以通过 Job Profile。

当分区表数据量较大时，建议以分区为粒度依次创建索引。

## 案例

```SQL
BUILD INDEX bulkload_data_index ON public.bulkload_data ;
```

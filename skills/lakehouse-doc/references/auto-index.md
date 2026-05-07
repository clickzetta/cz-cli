### 推荐原因

推荐的列可以用作表的 sort key。

挑选的是经常出现在过滤语句中的列。如果将这些列设置为表的 sort key，可以加快 query 的执行速度。

### 如何启用

* 可以在 workspace 上设置 property，系统会分析 workspace 下所有的表。

```Plain
ALTER WORKSPACE workspace_name SET properties (auto_index='day[,150,5,100]');

比如：
ALTER WORKSPACE quick_start SET properties (auto_index='day'); 
ALTER WORKSPACE quick_start SET properties (auto_index='day,150,5,100');

第一个参数为必须设置，即指定是每天收集还是每月收集，每月收集为每月1号收集，收集时间为晚上6点
第二个参数为使用最近多长时间的job（单位是分钟），默认为150
第三个参数为job需要重复多少次才会被使用，默认为5
第四个参数为每个列使用的最多的job数，默认为100
```

* 自动收集

系统会自动收集每个 schema 中过滤语句使用最多的 10 张表。

### 如何查询

```Plain
Select * from information_schema.sortkey_candidates;

返回结果比如:
instance_id,workspace_id,workspace_name,schema_id,schema_name,table_id,table_name,col,statement,ratio,insert_time,p_date
11111111111,855911111111,aaaaaaaaaaa,23671111111111,ddddddddd,84465111,aaaaaaaaaaa.ddddddddd.member,brandid,alter table aaaaaaaaaaa.ddddddddd.member set properties("hint.sort.columns"="brandid"), 2.21%,05:49.1,2024/11/7
11111111111,855911111111,aaaaaaaaaaa,23671111111111,ddddddddd,84465111,aaaaaaaaaa.ddddddddd.member,birthday,alter table aaaaaaaaaa.ddddddddd.member set properties("hint.sort.columns"="birthday"),0.01%,05:49.1,2024/11/7
11111111111,855911111111,aaaaaaaaaaa,23671111111111,ddddddddd,84465111,aaaaaaaaaaa.ddddddddd.member,id,alter table aaaaaaaaaaa.ddddddddd.member set properties("hint.sort.columns"="id"),0.01%,05:49.1,2024/11/7

可以看到对于aaaaaaaaaaa.ddddddddd.member表来说brandid的提升效果最高，所以设置为sortkey alter table aaaaaaaaaaa.ddddddddd.member set properties("hint.sort.columns"="brandid"),此设置会对

```

包含的列为：`instance_id`、`workspace_id`、`workspace_name`、`schema_id`、`schema_name`、`table_id`、`table_name`、`col`、`statement`、`ratio`、`insert_time`、`p_date`。

其中 `p_date` 为分区列，其格式是 `yyyy-mm-dd`。

`insert_time` 是收集结果插入的时间。

`col` 是推荐的列，当前为单列。

`statement` 是用于将推荐列设置为排序列的 SQL 语句。

`ratio` 为估算的提升效果，为百分比。

### 使用建议

建议使用 [analyze语句](<analyze-table.md>) 对表收集一下 column 的 stats，这会提高推荐的准确性。

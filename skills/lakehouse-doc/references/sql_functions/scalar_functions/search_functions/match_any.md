## MATCH\_ANY

```SQL
MATCH_ANY(inverted_column,query, option) 
```

### 功能说明

只有构建了倒排索引的列才能使用该函数，用于匹配其中任意分词后的字符串，忽略大小写。首先分析（analyze）查询字符串，然后根据分词结果构建查询，最终返回查询结果。例如，查询字符串是“Microsoft Azure Party”，被分析器分词之后，产生三个小写的单词：microsoft、azure 和 party，然后根据分析的结果构造一个布尔查询。默认情况下，引擎内部执行的查询逻辑是：只要 eventname 字段值中包含任意一个 microsoft、azure 或 party，就返回该行数据。

### 参数说明

* **inverted\_column**: 用于构建倒排索引的列。
* **query**: 您想要搜索的文本字符串。
* **option**: 此参数为必填项，用于指定分词设置。其设置必须与构建倒排索引的列所使用的分词方法相同。支持`auto`参数，该参数会自动与`inverted_column`中的分词设置进行匹配，例如：`map('analyzer', 'auto')`。

### 返回结果

boolean类型

### 案例

1. 案例一

```SQL
 select match_any('a b c', 'd a', map('analyzer', 'english')) as res;
 +------+
| res  |
+------+
| true |
+------+
 select match_any('a b c', 'b a d', map('analyzer', 'english')) as res;
  +------+
| res  |
+------+
| true |
+------+
```

2. 查询包含 Elfriede Heaney 的数据，要求同时包含 Elfriede 和 Heaney 则返回，不要求 Elfriede 和 Heaney 的先后顺序。

```SQL
--查询包含任意包含Elfriede Heaney两个单词的数据
select count(*) from bulkload_data where match_any(data,'Elfriede Heaney',map('analyzer', 'auto'));
+------------+
| `count`(*) |
+------------+
| 33614      |
+------------+
```

## MATCH\_REGEXP

```SQL
MATCH_REGEXP(inverted_column,query, option) 
```

### 功能说明

只有构建倒排索引的列才能使用该函数，匹配正则表达式，将inverted\_column的分词结果，使用query的正则表达式匹配，有任意匹配即可。首先会将query根据分词构建查询，比如inverted\_column中有一个字段的数据是“a b cd”，输入的query是"c.\*",query被分析器分词之后，产生两个小写的字母：b和c，然后根据分析的结果构造一个布尔查询，默认情况下，引擎内部执行的查询逻辑是：c.\*匹配到inverted\_column中的cd,结果为true。

### 参数说明

* **inverted\_column**: 用于构建倒排索引的列。
* **query**: 您想要搜索的文本字符串。
* **option**: 此参数是必填项，用于指定分词设置。它必须与用于构建倒排索引的列使用相同的分词方法。支持`auto`参数，该参数会自动与`inverted_column`中的分词设置进行匹配，例如：`map('analyzer', 'auto')`。

### 返回结果

boolean类型

### 案例

```SQL
select match_regexp('a b dc', '.*c', map('analyzer', 'english'))as res;
+------+
| res  |
+------+
| true |
+------+
```

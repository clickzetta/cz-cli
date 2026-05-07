## MATCH\_ALL

```SQL
MATCH_ALL(inverted_column,query, option) 
```

### 功能说明

只有构建了倒排索引的列才能使用该函数，用于匹配所有内容。首先分析（analyze）查询字符串，忽略大小写，然后根据分词结果构建查询，最终返回查询结果。例如，查询字符串是“Microsoft Azure Party”，被分析器分词之后，产生三个小写的单词：microsoft、azure 和 party。然后根据分析的结果构造一个布尔查询。默认情况下，引擎内部执行的查询逻辑是：只要 eventname 字段值中包含 microsoft、azure 和 party 这三个单词，那么就返回该行数据。

### 参数说明

* **inverted_column**: 已构建倒排索引的列。
* **query**: 您想要搜索的文本字符串。
* **option**: 此参数是必填项，用于指定分词设置。它必须与构建该倒排索引时使用的分词方法相同。支持 `auto` 参数，该参数会自动与 `inverted_column` 中的分词设置进行匹配，例如：`map('analyzer', 'auto')`。

### 返回结果

boolean类型

### 案例

* 案例一

```SQL
 select match_all('a b c', 'b a', map('analyzer', 'english')) as res;
 +------+
| res  |
+------+
| true |
+------+
 select match_all('a b c', 'b a d', map('analyzer', 'english')) as res;
 +-------+
|  res  |
+-------+
| false |
+-------+
 
```

* 案例二：查询包含 Elfriede Heaney 的数据，要求必须同时包含 Elfriede 和 Heaney，不要求先后顺序。

```SQL
--查询包含Elfriede Heaney的数据
select * from bulkload_data where match_all(data,'Elfriede Heaney',map('analyzer', 'auto'));
+------------------------------------------------------------------------------------------------------------------------------------------+
|                                                                   data                                                                   |
+------------------------------------------------------------------------------------------------------------------------------------------+
| {"address":"Apt. 423 78018 Wisozk Meadow, West Marge, WV 16958","name":"Elfriede Heaney","email":"jamar.schoen@gmail.com"}               |
| {"address":"Suite 654 89305 Dan Drive, Haiview, AZ 55461","name":"Elfriede Heaney","email":"kristofer.upton@yahoo.com"}                  |
| {"address":"1133 Cartwright Orchard, Port Jonathon, UT 71589-4026","name":"Elfriede Heaney","email":"douglass.nitzsche@yahoo.com"}       |
| {"address":"115 Avery Mountains, New Elfriede, TN 83686-3466","name":"Clarence Heaney","email":"emmanuel.lockman@yahoo.com"}             |
| {"address":"Suite 342 631 Konopelski Hollow, East Chingview, UT 79212","name":"Elfriede Heaney DDS","email":"mikel.keebler@hotmail.com"} |
| {"address":"415 Elfriede Row, New Adriene, SC 90250","name":"Jefferson Heaney","email":"len.price@yahoo.com"}                            |
+------------------------------------------------------------------------------------------------------------------------------------------+
```

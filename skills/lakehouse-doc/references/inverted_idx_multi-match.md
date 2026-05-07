# 倒排索引 multi-match 功能

`multi-match` 是一种强大的查询功能，它允许用户将一个**单一的查询字符串**同时在**多个字段**上进行搜索。这在许多实际应用场景中都非常有用，例如，当一个电商网站的用户在搜索框输入 "durable backpack" 时，系统可能需要同时在 `product_title` (产品标题)、`description` (描述) 和 `category` (分类) 等多个字段中查找。

当执行一个 multi-match 查询时，系统会在后台为指定的每一个字段执行匹配操作，然后将所有结果进行智能合并和排序，最终返回一个统一的相关度排序列表。

^

## 功能示例

### 数据准备：

测试数据表：

```
表名: dbpedia_entities_1m
创建时间: 2025-07-03 12:07:32
数据量: 1,000,000 行
存储大小: 12.6 GB
```

表结构：

* `id` (string) - 实体ID
* `title` (string) - 实体标题
* `text` (string) - 实体描述文本
* `vec` (vector(float,1536)) - 1536维向量

已构建索引如下：

|                                    |          |       |         |                           |
| ---------------------------------- | -------- | ----- | ------- | ------------------------- |
| 索引名称                               | 索引类型     | 目标字段  | 分析器     | 特殊配置                      |
| inverted\_multi\_match\_idx\_id    | INVERTED | id    | unicode | -                         |
| inverted\_multi\_match\_idx\_title | INVERTED | title | unicode | -                         |
| inverted\_multi\_match\_idx\_text  | INVERTED | text  | unicode | -                         |
| idx\_dbpedia\_vec\_1536            | VECTOR   | vec   | -       | ef.construction=128, m=64 |

### 功能示例：

#### 单列匹配

在 `title` 字段搜索，要求 'Paris Wisconsin Foster' 匹配度超67%

```SQL
SELECT    
    id,
    title
FROM dbpedia_entities_1m
WHERE multi_match (
            title,
            'Paris Wisconsin Foster',
            str_to_map('analyzer:unicode,minimum_should_match:67%')
      );
```

![](.topwrite/assets/image_1753846662848.png)

^

#### 多字段联合搜索

**三字段联合搜索 (ID + Title + Text)**

在 ` id, title, text` 三个字段中搜索，要求查询词中至少有3个匹配

```SQL
SELECT    id,
          title,
          text
FROM      dbpedia_entities_1m
WHERE     multi_match (
            id,
            title,
            text,
            'French deaf Avenue_Q Robert driver',
            str_to_map('analyzer:unicode,minimum_should_match:3')
          );
```

**结果**：返回2条相关记录，内容语义匹配准确。

```
id	                   title	    text
<dbpedia:Robert_Manzon>	 | Robert Manzon  | Robert Manzon (12 April 1917 – 19 January 2015) was a French racing driver. He participated in 29 Formula One World Championship Grands Prix, debuting on 21 May 1950. He achieved two podiums, and scored a total of 16 championship points. At the time of his death, Manzon was the last surviving driver to have taken part in the first Formula One World Championship in 1950.
<dbpedia:Robert_Benoist> | Robert Benoist | Robert Marcel Charles Benoist (20 March 1895 – 9 September 1944) was a French Grand Prix motor racing driver and war hero.
```

^

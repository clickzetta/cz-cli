### GET\_JSON\_OBJECT 函数

#### 功能描述

GET\_JSON\_OBJECT 函数用于从 JSON 格式的字符串（str）中提取特定字段的值。它接受两个参数：第一个参数是一个 JSON 格式的字符串，第二个参数是一个字符串，用于指定 JSON 对象中所需提取字段的路径。

#### 语法格式

```
get_json_object(string <str>, string <path>)
```

#### 参数说明

* str (string): 一个包含 JSON 格式数据的字符串。
* path (string): 一个描述所需提取字段位置的字符串路径。可以参考[json path规范](<https://goessner.net/articles/JsonPath/>)
    * "$" 表示根元素。
    * ".key" 或者 "\['key']" 用来查找 JSON object 中的 key。特殊的，"\[\*]" 表示获取所有的 value，要求 key 必须用单引号。
    * "\[index]" 用来根据 index 访问 JSON array 的元素，起始值为 0。特殊的，"\[\*]" 表示所有的元素。

#### 返回值

* 返回指定字段的值，类型为字符串。

#### 使用示例

1. 假设我们有一个 JSON 对象如下所示：
   ```json
   {
     "name": "张三",
     "age": 30,
     "address": {
       "city": "北京",
       "zipcode": "100000"
     },
     "hobbies": ["篮球", "旅游", "阅读"]
   }
   ```
   我们可以使用 GET\_JSON\_OBJECT 函数来提取 JSON 对象中的不同字段，例如：
   * 提取名字：
     ```sql
     SELECT get_json_object('{"name": "张三", "age": 30, "address": {"city": "北京", "zipcode": "100000"}, "hobbies": ["篮球", "旅游", "阅读"]}', '$.name');
     ```
     结果：张三
   * 提取城市：
     ```sql
     SELECT get_json_object('{"name": "张三", "age": 30, "address": {"city": "北京", "zipcode": "100000"}, "hobbies": ["篮球", "旅游", "阅读"]}', '$.address.city');
     ```
     结果：北京
   * 提取所有爱好：
     ```sql
     SELECT get_json_object('{"name": "张三", "age": 30, "address": {"city": "北京", "zipcode": "100000"}, "hobbies": ["篮球", "旅游", "阅读"]}', '$.hobbies');
     ```
     结果：\["篮球", "旅游", "阅读"]

2. 另一个例子，我们有一个 JSON 数组如下所示：
   ```json
   [
     {
       "id": 1,
       "name": "产品A",
       "price": 100
     },
     {
       "id": 2,
       "name": "产品B",
       "price": 200
     }
   ]
   ```
   我们可以使用 GET\_JSON\_OBJECT 函数来提取数组中特定元素的字段，例如：
   * 提取第一个产品的价格：
     ```sql
     SELECT get_json_object('[{"id": 1, "name": "产品A", "price": 100}, {"id": 2, "name": "产品B", "price": 200}]', '$[0].price');
     ```
     结果：100
   * 提取所有产品的名称：
     ```sql
     SELECT get_json_object('[{"id": 1, "name": "产品A", "price": 100}, {"id": 2, "name": "产品B", "price": 200}]', '$[*].name');
     ```
     结果：\["产品A", "产品B"]

通过以上示例，您可以看到 GET\_JSON\_OBJECT 函数在处理 JSON 数据时的灵活性和实用性。在实际应用中，您可以根据需要自由组合路径字符串，以提取 JSON 数据中的任意字段。

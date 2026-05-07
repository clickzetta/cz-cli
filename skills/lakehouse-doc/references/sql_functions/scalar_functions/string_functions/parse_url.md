### PARSE_URL 函数

#### 功能描述
PARSE_URL 函数用于从给定的 URL 中提取特定的部分。根据指定的 partToExtract 参数，可以从 URL 中提取主机名、路径、查询参数、引用、协议或文件名等信息。需要注意的是，该函数不会对 URL 的有效性进行校验。

#### 参数说明
* **url** (string 类型): 需要解析的 URL 地址。
* **partToExtract** (string 类型): 需要提取的 URL 部分，可选值包括：HOST, PATH, QUERY, REF, PROTOCOL, FILE。
* **key** (可选参数，string 类型): 当 partToExtract 为 QUERY 时，用于指定需要提取的查询参数的键名。

#### 返回值
函数返回提取到的 URL 部分，类型为 string。

#### 使用示例
以下示例展示了如何使用 PARSE_URL 函数提取不同部分的信息：

1. 提取主机名：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'HOST') AS host;
   ```
   结果：
   ```
   spark.apache.org
   ```

2. 提取路径：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'PATH') AS path;
   ```
   结果：
   ```
   /path
   ```

3. 提取查询参数：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'QUERY') AS query;
   ```
   结果：
   ```
   query=1
   ```

4. 提取引用：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'REF') AS ref;
   ```
   结果：
   ```
   ref
   ```

5. 提取协议：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'PROTOCOL') AS protocol;
   ```
   结果：
   ```
   http
   ```

6. 提取文件名：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1#ref', 'FILE') AS file;
   ```
   结果：
   ```
   /path?query=1
   ```

7. 提取特定键名的查询参数值：
   ```sql
   SELECT PARSE_URL('http://spark.apache.org/path?query=1&key=value#ref', 'QUERY', 'key') AS key_value;
   ```
   结果：
   ```
   value
   ```

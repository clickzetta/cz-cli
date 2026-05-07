### IPV4_STRING_TO_NUM 函数
```
ipv4_string_to_num(expr)
```

#### 功能描述
IPV4_STRING_TO_NUM 函数用于将 IPv4 地址的字符串形式转换为内部使用的 64 位整数（bigint）格式。这对于执行基于 IP 地址的数值比较和计算非常有用。

#### 参数说明
* `expr`：string 类型，表示要转换的 IPv4 地址字符串。

#### 返回结果
* 返回一个 64 位整数（bigint），表示输入的 IPv4 地址字符串对应的数值。

#### 使用示例
1.  将本地回环地址转换为数值：
    ```sql
SELECT ipv4_string_to_num("127.0.0.1");
-- 返回结果：2130706433
```
2.  将两个 IPv4 地址进行数值比较：
    ```sql
SELECT ipv4_string_to_num('192.168.1.1') > ipv4_string_to_num('192.168.1.2');
-- 返回结果：false
```
3.  计算一个 IPv4 地址范围内的主机数量：
    ```sql
SELECT (ipv4_string_to_num('192.168.1.255') - ipv4_string_to_num('192.168.1.0') + 1) AS host_count;
-- 返回结果：256
```



通过以上示例，您可以看到 IPV4_STRING_TO_NUM 函数在处理 IPv4 地址时的灵活性和实用性。此函数可以帮助您更方便地进行 IP 地址相关的数值计算和比较。
## 功能概述

`IS_IP_ADDRESS_IN_RANGE`用于判断一个 IP 地址是否包含在某个网络范围内。该函数接受一个 IP 地址和一个表示网络范围的 CIDR 表示法字符串，返回一个布尔值，指示 IP 地址是否在指定的网络范围内。

## 语法

```SQL
IS_IP_ADDRESS_IN_RANGE(address,prefix)
```

## 参数说明

* **address**: 要检查的 IP 地址，可以是 IPv4 或 IPv6 地址的字符串形式。
* **prefix**: 表示网络范围的 CIDR 表示法，也是一个字符串。

## 返回结果

如果 IP 地址在指定的网络范围内，返回 `true`；如果 IP 地址不在指定的网络范围内，则返回 `false`。

## 示例

示例 1：IPv4 地址范围检查

```SQL
SELECT is_ip_address_in_range('127.0.0.1', '127.0.0.0/8') as res;
+------+
| res  |
+------+
| true |
+------+
```

示例 2：IPv6 地址范围检查

```SQL
SELECT is_ip_address_in_range('::ffff:192.168.0.1', '::ffff:192.168.0.0/120') as res;
+------+
| res  |
+------+
| true |
+------+
```

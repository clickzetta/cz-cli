# CREATE SHARE

## 功能

`CREATE SHARE` 语句用于创建一个 SHARE 对象，以便进行数据管理和使用。创建的 SHARE 对象，其类型（kind 属性）为 OUTBOUND。

## 语法

```SQL
CREATE SHARE <share_name> ;
```

## 参数说明

* **share_name**: 指定要创建的 SHARE 名称。SHARE 名称的规则如下：

  * 支持字母、下划线和数字，不允许特殊字符和空格；
  * 仅支持字母和下划线开头，字母自动转为小写；
  * 长度为 1-255 字节；
  * 在同一个 account 下，share_name 必须是唯一的。

## 示例

**创建 SHARE**

```SQL
CREATE SHARE share_demo;
```

## 注意事项

* 在创建 SHARE 时，请确保 share_name 符合命名规则，否则将无法成功创建。
* 创建 SHARE 后，您可以使用 `SHOW SHARES` 语句查看当前 account 下的所有 SHARE。

```
SHOW SHARES WHERE KIND = 'OUTBOUND';
```

* 您可以使用 `DROP SHARE` 语句删除不再需要的 SHARE。

## 相关语句

* [SHOW SHARES](show-shares.md)
* [DROP SHARE](drop-share.md)

^

## 功能
本命令用于从当前 schema 或指定 schema 删除一个或多个视图。需要注意的是，一旦视图被删除，相关数据将无法通过该视图进行访问，除非重新创建视图。

## 语法

```
DROP VIEW [ IF EXISTS ] view_name;
```

## 参数说明

- `IF EXISTS`：可选参数，用于在视图不存在的情况下避免报错。
- `view_name`：指定要删除的视图名称。可以是单个视图名称，也可以使用<schema_name>.<view_name>格式指定schema和视图名称。

## 使用示例

**示例1：删除当前schema下的视图**

假设我们需要删除名为`myview`的视图，可以使用以下命令：

```
DROP VIEW myview;
```

**示例2：删除指定schema下的视图**

如果我们想要删除`my_schema`架构下的`myview`视图，可以使用以下命令：

```
DROP VIEW my_schema.myview;
```



# 修改分享对象（SHARE）

## 功能描述

该语句用于修改分享对象（SHARE）。您可以使用此语句为分享对象添加或移除目标服务实例（INSTANCE）。

## 语法

```SQL
ALTER SHARE <share_name> [ADD | REMOVE] INSTANCE <instance_name>;
```

## 参数说明

1. **share_name**：需要修改的分享对象名称。
2. **ADD | REMOVE**：对分享对象的操作，ADD 表示添加分享目标服务实例，REMOVE 表示移除已分享的服务实例。
3. **instance_name**：服务实例的名称，需确保全局唯一。服务消费端用户可以在首页右侧或在服务实例的 URL 中找到自己的服务实例名称，并提供给分享者进行配置。

## 使用示例

**添加分享目标服务实例**

假设您创建了一个名称为`SHARE_DEMO`的分享对象，其 `kind` 属性为 ‘OUTBOUND’，想要将其分享给名为`instancedemo`的服务实例，可以使用以下语句：

```SQL
ALTER SHARE SHARE_DEMO ADD INSTANCE instancedemo;
```

**移除分享目标服务实例**

如果您创建了一个名称为`SHARE_DEMO`的分享对象，并且已分享给名为 `instancedemo` 的服务实例，想要收回对该服务实例的分享，可以使用以下语句：

```SQL
ALTER SHARE SHARE_DEMO REMOVE INSTANCE instancedemo;
```

## 注意事项

* 确保在执行此操作时，已登录到具有相应权限的账户。
* 在添加或移除分享目标服务实例时，请确保输入的实例名称正确无误。
* 对 SHARE 对象执行 REMOVE INSTANCE 后，目标服务实例会立即失去使用该分享数据的权限。请谨慎操作，确认操作影响。

通过以上步骤，您可以轻松地管理分享对象及其关联的服务实例。

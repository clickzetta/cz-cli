# 查看分享列表

## 功能

查看分享列表用于查询当前实例下所有的分享对象（share对象），帮助用户了解当前服务实例与其他服务实例之间的数据共享情况。

## 语法

```SQL
SHOW SHARES  [LIKE 'pattern' | WHERE expr] [LIMIT num]
```

## 参数说明

1. `LIKE pattern`：此选项为可选参数，用于按对象名称进行过滤。支持不区分大小写的模式匹配，并可使用SQL通配符`%`（表示任意数量的字符）和`_`（表示单个字符）。示例：`LIKE '%testing%'`。需要注意的是，此过滤器不支持与`WHERE`条件同时使用。

2. `WHERE expr`：此选项为可选参数，支持用户根据`SHOW SHARES`命令显示的字段进行筛选。如：provider、provider\_instance、provider\_workspace、scope、to\_instance、kind

## 返回说明

* **provider**：share提供者的租户名，表示分享数据的来源。
* **provider\_instance**：share提供者的服务实例名，表示分享数据的服务实例。
* **provider\_workspace**：share所属的工作空间，表示share对象所在的工作空间。
* **scope**：share的分享范围，当前仅支持PRIVATE——指定instance分享。表示share对象仅在指定的服务实例之间共享。
* **to\_instance**：该share对象指定被分享至的服务实例名称，多个服务实例名称之间用英文逗号(,)分隔。表示当前share对象被分享给了哪些服务实例。
* **kind**：share的类型，OUTBOUND为当前服务实例分享出的数据，INBOUND为其他服务实例分享至当前服务服务实例的数据。表示当前share对象是分享数据的来源还是接收数据的目的地。

## 使用示例

1. 查询当前服务实例下的所有分享对象：

   ```SQL
   SHOW SHARES ;
   ```

   假设返回结果如下：

   ```
   share_name |provider| provider_instance | provider_workspace | scope | to_instance | kind 
   -----------------------+-------------------+--------------------+-------+---------------+-----
   sample_data |my_tenant | my_service_instance | my_workspace       | PRIVATE | other_instance | OUTBOUND
   another_demo |another_tenant | another_service_instance | another_workspace  | PRIVATE | my_service_instance | INBOUND
   ```

   在这个例子中，我们可以看到当前服务实例有两个分享对象。第一个对象是当前服务实例分享给名为other\_instance的服务实例的，分享范围为PRIVATE。第二个对象是来自另一个服务实例的分享，当前服务实例作为接收方。

2. 使用**Like**参数过滤特定名称的分享对象：

   ```SQL
   SHOW SHARES LIKE '%data';
   ```

   假设返回结果如下：

   ```
   share_name |provider| provider_instance | provider_workspace | scope | to_instance | kind 
   -----------------------+-------------------+--------------------+-------+---------------+-----
   sample_data |my_tenant | my_service_instance | my_workspace       | PRIVATE | other_instance | OUTBOUND

   ```

3. 使用**WHERE**参数过滤输出结果，查询当前服务实例**分享出**的分享对象：

   ```SQL
   SHOW SHARES WHERE kind = 'OUTBOUND';
   ```

   假设返回结果如下：

   ```
   share_name | provider | provider_instance | provider_workspace | scope | to_instance | kind 
   -----------------------+-------------------+--------------------+-------+---------------+-----
   sample_outbound_share |my_tenant | my_service_instance | my_workspace| PRIVATE | other_instance | OUTBOUND
   ```

   可以看到，当前服务实例分享给了名为other\_instance的服务实例一个名为sample\_outbount\_share 的分享对象。

4. 使用**WHERE**参数过滤输出结果，查询当前服务实例**被分享**的分享对象：

```SQL
   SHOW SHARES WHERE kind = 'INBOUND';
```

&#x20;     假设返回结果如下：

```
share_name | provider | provider_instance | provider_workspace | scope | to_instance | kind 
-----------------------+-------------------+--------------------+-------+---------------+-----
sample_inbound_share |other_tenant | other_instance | demo_workspace| PRIVATE | current_instance | INBOUND
```

可以看到，当前服务实例被分享了名为sample\_inbound\_share 的，来自于实例名称为other\_instance分享对象。

通过以上示例，您可以更轻松地查看和管理当前服务实例下的所有分享对象。

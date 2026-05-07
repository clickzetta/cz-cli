## 功能

该命令用于展示计算集群的详细信息，包括集群的属性、状态等。通过使用该命令，用户可以更好地了解和管理计算集群。

## 语法

```SQL
DESC[RIBE] VCLUSTER [EXTENDED] NAME;
```

## 参数说明

* **DESC\[RIBE**]：关键字，可以使用DESC或DESCRIBE两种写法。
* **NAME**：指定需要查看的计算集群名称。
* **EXTENDED**：（可选）关键字，用于获取计算集群的更多扩展信息。

## 使用示例

1. 查看名为sample\_vc的计算集群的基本信息：

```SQL
DESC VCLUSTER sample_vc;
```

2. 查看名为sample\_vc的计算集群的所有扩展信息：

```SQL
DESC VCLUSTER EXTENDED sample_vc;
```

3. 查看名为production\_vc的计算集群，并且只显示与计算节点相关的信息：

```SQL
DESC VCLUSTER production_vc;
```

## 注意事项

* 请确保在执行该命令时，已连接到有效的Lakehouse服务实例。
* 使用关键字EXTENDED可以获取更多关于计算集群的信息，但可能会影响查询性能。

^

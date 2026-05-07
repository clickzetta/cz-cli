## 功能描述

本命令用于展示用户所拥有的作业信息，包括已完成和正在运行的作业。默认情况下，会显示最近7天内提交的任务记录，最多可查询10000条记录。用户可以根据需要查看指定计算资源下的作业信息。

## 语法格式

```SQL
SHOW JOBS [IN VCLUSTER vc_name] [LIKE 'pattern' ]  [WHERE <expr>]  [LIMIT num];
```

## 参数说明

- `IN VCLUSTER vc_name`：（可选）指定计算资源名称，用于筛选特定计算资源下的作业信息。
- ` WHERE <expr>`:WHERE <expr>:(可选)支持用户根据`SHOW JOBS`命令显示的字段进行筛选。用户可以通过表达式对结果进行过滤，以便更精确地查找所需的数据。
- `LIMIT num`：（可选）限制返回的作业记录数量，范围为1-10000。
- LIKE 'pattern': （可选）使用通配符模式匹配job_id（支持`%`和`_`）

## 使用示例

1. 查看在test计算资源下大于2分钟的作业：

```
SHOW JOBS IN VCLUSTER test WHERE execution_time >interval 2 minute;
```

2. 查看计算资源“my_vc”下的所有作业记录：

```
SHOW JOBS IN VCLUSTER my_vc;
```

3. 限制返回的作业记录数量为100条：

```
SHOW JOBS LIMIT 100;
```

4. 查看计算资源“my_vc”下最近7天内提交的50条作业记录：

```
SHOW JOBS IN VCLUSTER my_vc LIMIT 50;
```

## 注意事项

- 请确保在执行命令时，正确填写计算资源名称和限制数量。
- 如果未指定计算资源名称，系统将默认展示所有计算资源下的作业信息。
- 请根据实际需求合理设置查询时间范围和记录数量，以便快速获取所需信息。
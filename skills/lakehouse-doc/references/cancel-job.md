# 终止作业

## 功能描述

本功能允许用户终止正在运行的作业或取消某个虚拟集群下的所有作业。通过该功能，用户可以有效地管理作业进度，避免资源浪费。

## 语法说明

```
-- 取消单个作业
CANCEL JOB 'jobid';

-- 取消某个VIRTUAL CLUSTER下所有作业
ALTER VCLUSTER [ IF EXISTS ] vc_name CANCEL ALL JOBS;
```

## 参数说明

1. `jobid`：作业运行的唯一标识符，字符串格式。作业运行时，日志会打印出jobid，同时在[show jobs](<show-jobs.md>)命令中也会显示相应的jobid。
2. `vc_name`：指定的虚拟集群名称。如果虚拟集群不存在，使用`IF EXISTS`选项可以避免因找不到集群而产生错误。

## 使用示例

### 示例1：取消单个作业

假设您需要取消一个作业，其jobid为`201xxxxxxxxxx`。您可以使用以下命令实现：

```
CANCEL JOB '201xxxxxxxxxx';
```

### 示例2：取消某个虚拟集群下所有作业

假设您需要取消名为`my_vc`的虚拟集群下的所有作业。首先，使用以下命令取消该虚拟集群下的所有作业：

```
ALTER VCLUSTER my_vc CANCEL ALL JOBS;
```

如果担心虚拟集群不存在导致错误，可以使用`IF EXISTS`选项：

```
ALTER VCLUSTER IF EXISTS my_vc CANCEL ALL JOBS;
```

## 注意事项

* 确保在执行终止作业操作时，输入正确的`jobid`或`vc_name`，以免影响其他作业或虚拟集群的正常运行。
* 终止作业后，已使用的资源将被释放，但请注意，已消耗的时间和费用可能无法退回。

^

# ClickZetta Travel：数据迁移与SQL转译工具

## 简介

ClickZetta Travel 是由云器研发团队精心打造并开源的一款工具，旨在帮助用户轻松实现从其他数据系统向 ClickZetta Lakehouse 的数据迁移。它提供了一系列强大的功能，包括：
- 将其他 SQL 方言转译为 ClickZetta Lakehouse 兼容的 SQL。
- 在源数据系统和 ClickZetta Lakehouse 上分别执行 SQL 并对比结果集。
- 易于使用的 Web UI，提供直观的操作界面。
- 命令行工具，支持批量 SQL 迁移。

## 安装与启动

### 安装步骤

1. 确保已安装 Docker。
2. 通过以下命令获取 ClickZetta Travel 的 Docker 镜像：

```shell
# 获取镜像
docker pull clickzetta/clickzetta-travel:dev
```

3. 在本地创建一个名为 `travel` 的文件夹，用于存放评估所需的配置和数据。

```shell
mkdir travel
cd travel
```

### 启动 Web UI

运行以下命令启动 ClickZetta Travel 的 Web UI：

```shell
docker run --rm --name cztravel -v $(pwd):/mnt/userdata -p 8501:8501 clickzetta/clickzetta-travel:dev
```

访问 http://localhost:8501/unify 即可使用 Web UI。

## 使用方法

### Web 页面交互式评估

#### 转译 SQL

1. 在浏览器中打开 http://localhost:8501/unify。
2. 选择您所使用的数据平台。
3. 在输入框中填入待转译的 SQL。
4. 使用快捷键（输入框右下角有提示）或使输入框失去焦点，待输入内容生效后，页面将自动以左右对比的方式展示原始和转译后的 SQL。

![transpile screenshot](travel_screenshot_transpile.png)

#### 执行 SQL 并对比结果

1. 进行数据库连接配置。
   - 展开页面上的 config template，可以看到配置文件模板。
   - 将编辑好的配置文件通过页面上传；或直接在宿主机数据目录下新建 conf 子目录，并在此处准备好配置文件，刷新页面后即可从 “select config file” 处选择。
   - 若配置文件正确，页面将展示连接成功的信息。
2. 选择校验方式，并点击 Validate 按钮运行 SQL 并校验结果集。
   - Basic verification：基于有限的基础统计信息校验。
   - Multidimensional verification：基于丰富的统计信息校验。
   - Line by line verification：逐行校验。

![validate screenshot](travel_screenshot_validate.png)

### 命令行批量评估

收集待评估的 SQL 语句，将其以一个或多个文件的形式存放到数据目录。当一个文件内包含多个 SQL 语句时，语句间需以分号（;）分隔。

```shell
# 进入 docker 的命令行环境
docker exec -it cztravel /bin/bash
# 切换到数据目录
cd /mnt/userdata
```

命令行环境中提供的批量评估命令为 `travel`。该工具：
- 接受一个或多个内容为以分号分隔的 SQL 的文件。
- 识别并拆分、编号输入文件中的 SQL 语句，将其转译为 ClickZetta Lakehouse SQL，并在 Lakehouse 上尝试执行这些语句。
- 产出数据目录，包括评估摘要以及运行数据。运行数据包括执行成功的 SQL 语句、无法转译的 SQL 语句以及智能分类过的执行失败的 SQL 语句。
- 通过 `travel --help` 可以获取最新的帮助信息。

示例：
```shell
root@bce68cf855b8:/mnt/userdata#> travel -c conf/cz_conf.json batch-0906.sql

# 屏显持续输出运行日志，直至最终给出运行摘要
summary:
original sql      : 777
transpiled        : 777, 100.00%
transpile failed  : 0, 0.00%
empty or set sql  : 1
valid for running : 776
run succeed       : 763, 98.32%
run failed        : 13, 1.68%

classified failed reasons:
reason_0        1       submit sql job failed:SQL job execute failed.Error:CZLH-00000:Failed to generate call action, function not found: IN(bin,bin...)->b
reason_1        2       submit sql job failed:SQL job execute failed.Error:CZLH-22007:DateTimeFormatter: pattern not supported ZONE_OFFSET_X - z : +0000; -08; -0830; -08:30; -083015; -08:30:15;. Detail  taskId 0, vertex name=stg4, vertexId=2023091814422045379827447_48514-V4
reason_2        2       submit sql job failed:SQL job execute failed.Error:CZLH-22007:DateTimeFormatter: unknown pattern letter: W. Detail  taskId 0, vertex name=stg0, vertexId=2023091814365582826010390_48392-V0
reason_3        2       submit sql job failed:SQL job execute failed.Error:CZLH-42000:[1,170] Semantic analysis exception - operator not found, string - string
...

# 2023-10-10_22-24-24 为此次运行产出的数据目录
# last 符号链接永远指向最后一次运行的数据目录
root@bce68cf855b8:/mnt/userdata#> ls -l
total 18408
drwxr-xr-x@ 36 robert  staff   1.1K 10 10 22:48 2023-10-10_22-24-24/
-rw-r--r--@  1 robert  staff   9.0M 10 10 22:22 batch-0906.sql
drwxr-xr-x@  6 robert  staff   192B 10  8 19:03 conf/
lrwxr-xr-x@  1 robert  staff    19B 10 10 22:48 last@ -> 2023-10-10_22-24-24

# 数据目录结构示意如下，可以从宿主机直接浏览并处理其中的数据
robert@Roberts-MBP ~/D/travel> tree last
last/
├── log.txt # 全部执行日志
├── reason_0
├── reason_1
│   ├── run.452.clickzetta.sql # 第 452 号 SQL 在 Lakehouse 的执行内容
│   ├── run.452.doris.sql      # 第 452 号 SQL 的原始信息
│   ├── run.776.clickzetta.sql
│   └── run.776.doris.sql
├── reason_2
...
├── success # 执行成功的 SQL，可以后续用于压测
└── summary.txt # 摘要

# .clickzetta.sql 文件中记录了 Lakehouse 执行的转译的 SQL 内容、job id、失败的原因等信息
robert@Roberts-MBP ~/D/travel> cat last/reason_1/run.452.clickzetta.sql
WITH dt AS (SELECT ... DATE_FORMAT(`t1`.`created_at`, '%x') AS p, ... LIMIT 1000

-- exception for job_id: 2023091814422045379827447
-- submit sql job failed:SQL job execute failed.Error:CZLH-22007:DateTimeFormatter: pattern not supported ZONE_OFFSET_X - z : +0000; -08; -0830; -08:30; -083015; -08:30:15;. Detail  taskId 0, vertex name=stg4, vertexId=2023091814422045379827447_48514-V4
```
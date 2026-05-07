# DataX ClickZettaWriter 插件

## DataX 简介

DataX 是阿里巴巴开源的数据同步工具，支持多种数据源，包括关系型数据库、HDFS、Hive、MaxCompute、HBase、FTP 和本地文件等。本文档将介绍如何使用 DataX ClickZettaWriter 插件，实现 DataX 同步数据到 ClickZetta LakeHouse。
## 使用限制
- 不支持vector和json类型

## 准备工作

1. 请确保已安装 DataX。具体安装方法，请参考 [DataX 使用指南](https://github.com/alibaba/DataX/tree/master)。
2. 下载 DataX ClickZettaWriter 插件，下载地址：[DataX ClickzettaWriter 插件](https://autolake-dev-beijing.oss-cn-beijing.aliyuncs.com/clickzetta-tool/dataxwriter/datax.tar.gz)。将插件解压到 DataX 安装目录下的 `plugin/writer` 目录下。
3. 在使用 DataX ClickZettaWriter 插件前，请确保在 ClickZetta LakeHouse 中已经创建了相应的表。

## 使用 DataX ClickZettaWriter 插件

### 1. 创建配置文件

以下用例展示了如何使用 DataX ClickZettaWriter 插件将 MySQL 数据同步到 ClickZetta LakeHouse。

```json
{
  "job": {
    "content": [
      {
        "reader": {
            "name": "mysqlreader",
            "parameter": {
                "column": ["*"],
                "connection": [
                    {
                        "jdbcUrl": ["jdbc:mysql://mysql_host:mysql_port/database?useSSL=false"],
                        "table": ["test_table"]
                    }
                ],
                "password": "example",
                "username": "example",
                "where": ""
            }
        },
        "writer": {
          "name": "clickzettawriter",
          "parameter": {
              "column": ["*"],
              "connection": [
                  {
                      "jdbcUrl": "jdbc:clickzetta://instance.service/workspace?schema=example&username=example&password=example&vcluster=example",
                      "table": ["test_table"]
                  }
              ],
              "password": "example",
              "username": "example",
              "preSql": [],
              "postSql": [],
              "writeMode": "overwrite",
              "tableNumber": "1",
              "partitionColumns": {
                  "region" : "example"
              }
          }
        }
      }
    ],
    "setting": {
      "speed": {
        "channel": 1
      }
    }
  }
}
```

配置说明：

* `mysqlreader`：DataX 内置的 mysqlreader 插件，用于读取 MySQL 数据。具体使用方法，请参考 [mysqlreader 插件文档](https://github.com/alibaba/DataX/blob/master/mysqlreader/doc/mysqlreader.md)。
* `clickzettawriter` 参数说明：
  * `jdbcUrl`：LakeHouse JDBC 连接信息。
  * `table`：写入的表名（仅支持写入一张表）。
  * `column`：写入的列名（`*` 星号表示所有列）。
  * `partitionColumns`：分区列名，用于分区表写入（`column` 指定的列加上分区别必须是表的所有列）。
  * `writeMode`：写入模式，可选值为 `append`、`overwrite` 和 `upsert`，默认为 `append`。
  * `username`：LakeHouse 用户名。
  * `password`：LakeHouse 密码。
  * `preSql`：写入前执行的 SQL 语句。
  * `postSql`：写入后执行的 SQL 语句。

### 2. 执行同步任务

运行以下命令以执行同步任务：

```shell
python bin/datax.py job.json
```

## 使用示例

### 示例 1：同步 MySQL 数据到 ClickZetta LakeHouse

以下配置文件示例将 MySQL 中的 `test_table` 数据同步到 ClickZetta LakeHouse 的 `example_table`。

```json
{
    "job": {
        "content": [
            {
                "reader": {
                    "name": "mysqlreader",
                    "parameter": {
			"column": ["*"],
               		"connection": [
                  	  {
                        	"jdbcUrl": ["jdbc:mysql://mysql_host:mysql_port/database?useSSL=false"],
                      		"table": ["test_table"]
                    }
                ],
                "password": "example",
                "username": "example",
                "where": ""
                    }
                },
                "writer": {
                	          "name": "clickzettawriter",
          "parameter": {
              "column": ["*"],
              "connection": [
                  {
                      "jdbcUrl": "jdbc:clickzetta://your_instance_name.api.clickzetta.com/your_workspace_name?schema=sample&username=your_user_name&password=your_password&vcluster=your_vcluster_name",
                      "table": ["example_table"]
                  }
              ],
                      "partitionColumns": {
                        "region" : "example"
                      },
              "password": "your_password",
              "preSql": [],
              "session": [],
              "username": "your_user_name",
              "writeMode": "append",
              "tableNumber": "1"
          }
        }
      }
    ],
    "setting": {
      "speed": {
        "channel": 1
       }
    }
  }
}
        
```

^

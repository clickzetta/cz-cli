# 数据源支持范围

在使用数据同步服务之前，为了确保您的同步需求得到满足，请先确认数据同步服务是否覆盖了您所需的数据源，并选择合适的任务类型。目前，数据同步服务支持以下三种同步任务类型：

1. 单表离线同步：适用于支持的数据源，提供单表读取和写入的离线同步功能。
2. 单表实时同步：针对支持的数据源，实现单表读取和写入的实时同步功能。
3. 多表实时同步：针对支持的数据源，提供一次性全量同步和实时增量同步的多表功能。

各类任务类型当前支持的数据源类型和版本如下（包括但不限于以下类型，请以产品内实际支持为准）：

### 离线同步

| 数据源 | 发布等级 | 离线单表读 | 离线单表写 | 支持版本 |
| --------------------- | ------- | ---- | ---- | --------------------- |
| 云器Lakehouse | GA | √ | √ | - |
| ADB MySQL              | GA (Beta) | √     | √     | 3.x                    |
| ADB PostgreSQL         | GA (Beta) | √     | √     | 6.x                    |
| AMQP                   | GA (Beta) | √     | X     | -                      |
| AutoMQ                 | GA       | √     | √     | -                      |
| ClickHouse | GA | √ | √ | 19.x及以上 |
| COS                    | GA       | √     | √     | -                      |
| Databricks             | GA       | √     | √     | -                      |
| DB2                    | GA (Beta) | √     | √     | 11.x                   |
| DM                     | GA (Beta) | √     | √     | 8.x                    |
| Doris                  | GA (Beta) | √     | √     | 1.x                    |
| DynamoDB               | GA       | √     | √     | -                      |
| Elasticsearch          | GA       | √     | √     | 7.x                    |
| Greenplum | GA (Beta) | √ | √ | 5.x及以上 |
| HBase | GA | X | √ | 1.4+ |
| Hive                   | GA       | √     | √     | 2.x                    |
| Hologres               | GA (Beta) | √     | √     | -                      |
| Kafka | GA | √ | √ | 0.8.x, 0.9.x, 0.10.x, 2.x |
| MaxCompute             | GA       | √     | X     | -                      |
| MariaDB                | GA (Beta) | √     | √     | -                      |
| MongoDB | GA | √ | X | 3.4及以上 |
| MySQL                  | GA       | √     | √     | 5.x，8.x                |
| Oracle                 | GA (Beta) | √     | √     | -                      |
| OSS                    | GA       | √     | √     | -                      |
| PolarDB for MySQL      | GA       | √     | √     | -                      |
| PolarDB for PostgreSQL | GA       | √     | √     | -                      |
| PostgreSQL | GA | √ | √ | 9.4及以上 |
| Redis                  | GA       | X     | √     | -                      |
| Redshift               | GA (Beta) | √     | √     | -                      |
| RestApi                | GA       | √     | X     | -                      |
| SLS（LogHub）            | GA       | √     | X     | -                      |
| SQL Server | GA | √ | √ | 2012及以上 |
| StarRocks              | GA (Beta) | √     | √     | 2.5                    |
| TiDB                   | GA (Beta) | √     | √     | -                      |

### 实时同步

| 数据源 | 发布等级 | 实时单表读 | 实时多表读 | 实时写 | 支持版本 |
| --------------- | --- | ---- | ---- | ---- | ---- |
| 云器Lakehouse | GA | X | X | √ | - |
| AutoMQ                 | GA   | √     | X     | X   | -             |
| Kafka | GA | √ | X | √ | 0.8.x, 0.9.x, 0.10.x, 2.x |
| MySQL | GA | √ | √ | X | 5.x, 8.x |
| PolarDB for MySQL      | GA   | √     | √     | X   | -         |
| PolarDB for PostgreSQL | GA   | √     | √     | X   | -       |
| SQL Server | GA | √ | √ | X | SQL Server 2016 Service Pack 1 (SP1) 及以上版本 |

^

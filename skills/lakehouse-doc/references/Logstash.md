Logstash 是一个开源的数据处理管道，它能够同时从多个来源采集数据，对数据进行处理，并将其发送到您选择的目的地。Logstash 是 Elastic Stack（以前称为 ELK Stack）的一部分，该技术栈还包括 Elasticsearch 和 Kibana。这三个工具通常一起使用，以提供强大的搜索、分析和可视化功能。Lakehouse 提供了 Logstash Connector，可以直接连接 Lakehouse。


# 部署

```JSON
# 卸载插件
./bin/logstash-plugin uninstall logstash-output-clickzetta && rm -rf ./vendor/local_gems/

# 安装插件
./bin/logstash-plugin install --no-verify --local logstash-output-clickzetta-0.0.1.gem 

# 查看插件
./bin/logstash-plugin list --verbose
```

> 安装插件时，虽然指定了 `--no-verify --local`，但仍似乎会去远程服务器上下载或校验某些包。所以安装时如果碰到长时间卡在 `installing ...` 环节，可以直接按 `Ctrl+C` 强制终止。此时插件可能已经安装成功，可以通过查看插件列表来验证。

# 测试

```JSON
cd /logstash-data
/usr/share/logstash/bin/logstash -f data/logstash.conf.5 --log.level error
# 默认worker数为机器核数（-w），默认batch size为125(-b)，可通过 -w 16 -b 200 进行调整对应参数
```

**File input**

参考 [file input 插件](https://www.elastic.co/guide/en/logstash/7.17/plugins-inputs-file.html#plugins-inputs-file-sincedb_clean_after)

```JSON
input {
  file {
                path => "/logstash-data/data/igs_worker_full_log.log"
                codec => json
                start_position => "beginning"
                mode => "read"
                file_completed_action => log
                file_completed_log_path => "/logstash-data/data/temp_log/"
                exit_after_read => true
                sincedb_clean_after => "1 second"
        }
  file {
                path => "/logstash-data/data/igs_worker_full_log_1.log"
                codec => json
                start_position => "beginning"
                mode => "read"
                file_completed_action => log
                file_completed_log_path => "/logstash-data/data/temp_log/"
                exit_after_read => true
                sincedb_clean_after => "1 second"
        }
  file {
                path => "/logstash-data/data/igs_worker_full_log_2.log"
                codec => json
                start_position => "beginning"
                mode => "read"
                file_completed_action => log
                file_completed_log_path => "/logstash-data/data/temp_log/"
                exit_after_read => true
                sincedb_clean_after => "1 second"
        }
  file {
                path => "/logstash-data/data/igs_worker_full_log_3.log"
                codec => json
                start_position => "beginning"
                mode => "read"
                file_completed_action => log
                file_completed_log_path => "/logstash-data/data/temp_log/"
                exit_after_read => true
                sincedb_clean_after => "1 second"
        }
  file {
                path => "/logstash-data/data/igs_worker_full_log_4.log"
                codec => json
                start_position => "beginning"
                mode => "read"
                file_completed_action => log
                file_completed_log_path => "/logstash-data/data/temp_log/"
                exit_after_read => true
                sincedb_clean_after => "1 second"
        }
}

output {
    clickzetta {
            jdbcUrl => "jdbc:clickzetta://9a310b9b.<region\_id>.api.clickzetta.com/quick_start?schema=public&username=index_test&password=password&virtualCluster=YETING_TEST_AP"
            username => "index_test"
            password => "password"
            schema => "public"
            table => "test_simple_data-%{+YYYY.MM.dd}"
            internalMode => false
            directMode => false
        }
}
```

**Kafka input**

Kafka input 配置参考 \[[kafka作为input接入](https://help.aliyun.com/zh/apsaramq-for-kafka/connect-an-apsaramq-for-kafka-instance-to-logstash-as-an-input-over-the-internet)]

> 由于本测试用例是阿里云的 Kafka 组件，需要配置相关 SSL 证书，其他云环境可能有所区别，需要按照其他云服务商官方文档操作。
>
> ssl\_truststore\_location 配置需要使用 \[[这里](https://github.com/AliwareMQ/aliware-kafka-demos/blob/master/kafka-java-demo/vpc-ssl/src/main/resources/only.4096.client.truststore.jks)] 下载的证书

```JSON
input {
    kafka {
                bootstrap_servers => "alikafka-pre-cn-co92y9d22001-1.alikafka.aliyuncs.com:9093,alikafka-pre-cn-co92y9d22001-2.alikafka.aliyuncs.com:9093,alikafka-pre-cn-co92y9d22001-3.alikafka.aliyuncs.com:9093"
                group_id => "logstash-test-group"
                decorate_events => true
                topics => ["igs-worker-log-for-sla"]
                security_protocol => "SASL_SSL"
                sasl_mechanism => "PLAIN"
                sasl_jaas_config => "org.apache.kafka.common.security.plain.PlainLoginModule required username='username' password='password';"
                ssl_truststore_password => "KafkaOnsClient"
                ssl_truststore_location => "/logstash-data/only.4096.client.truststore.jks"
                ssl_endpoint_identification_algorithm => ""
                consumer_threads => 3
                codec => json {
                    charset => "UTF-8"
                }
        }
}

filter {
mutate {
    add_field => {
        "kafka_topic_name" => "%{[fields][log_topic]}"
    }
}
grok {
    match => { "message" => "\[%{TIMESTAMP_ISO8601:@timestamp}\] \[%{NUMBER:thread_id}\] \[%{LOGLEVEL:log_level}\] \[%{DATA:source_file}\] \[%{DATA:function_name}\]%{GREEDYDATA:log_content}" }
}
ruby {
        code => "
            if event.get('thread_id').to_i % 2 == 0
                event.tag('even')
            else
                event.tag('odd')
            end
        "
    }
}
output {
    if "odd" in [tags] {
        clickzetta {
            jdbcUrl => "jdbc:clickzetta://9a310b9b.<region\_id>.api.clickzetta.com/quick_start?schema=public&username=index_test&password=password&virtualCluster=YETING_TEST_AP"
            username => "index_test"
            password => "password"
            schema => "public"
            table => "liuwei_log_data-odd-%{kafka_topic_name}-%{+YYYY.MM.dd}"
            tablet => 16
            debug => true
            internalMode => false
            directMode => false
        }
    } else {
        clickzetta {
            jdbcUrl => "jdbc:clickzetta://9a310b9b.<region\_id>.api.clickzetta.com/quick_start?schema=public&username=index_test&password=password&virtualCluster=YETING_TEST_AP"
            username => "index_test"
            password => "password"
            schema => "public"
            table => "liuwei_log_data-even-%{kafka_topic_name}-%{+YYYY.MM.dd}"
            tablet => 16
            debug => true
            internalMode => false
            directMode => false
        }
    }
}
```

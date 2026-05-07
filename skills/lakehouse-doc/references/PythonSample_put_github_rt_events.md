# 使用Python任务实时获取GitHub的事件并导入Lakehouse表

<https://api.github.com/events> 提供 API 服务，可以实时获取 5 分钟前的事件数据。通过 API 获得准实时数据，结合从 gharchive 网站通过文件方式同步的离线数据，可将数据的时效性从小时级别提升到分钟级别，进一步提升数据的新鲜度，更好地服务于对数据新鲜度有更高要求的应用。
本示例也演示了如何通过云器 Lakehouse 的 [Python connect将数据以bulkload](use-python-sdk-upload-data.md) 方式将数据写入表中。

## 创建目标表

在 SQL 脚本任务节点中执行如下建表语句。

```
CREATE TABLE IF NOT EXISTS `github_timeline_realtime_events` (

`id` STRING,

`type` STRING,

`repo_id` STRING,

`repo_name` STRING,

`minute` STRING,

`second` STRING,

`created_at` TIMESTAMP,

`data` STRING COMMENT 'record data, json format',

`__last_modified__` STRING COMMENT '__last_modified__'

) PARTITIONED BY (DATE STRING,HOUR STRING) COMMENT 'public GitHub timeline record,real time events, ingested from https://api.github.com/events';

```

## 编写Python代码

```
import requests,json

import time

import pytz

import pandas as pd

from requests.exceptions import RequestException

from datetime import datetime, timedelta

from clickzetta import connect

from clickzetta.bulkload.bulkload_enums import BulkLoadOptions,BulkLoadOperation,BulkLoadCommitOptions

def get_lakehouse_connect():

    conn = connect(

    username='',

    password='',

    service='<region\_id>.api.clickzetta.com',

    instance='',

    workspace='gharchive',

    schema='public',

    vcluster='default')

    return conn

def get_lakehouse_queries_data_hints(sql_query,query_tag):

    conn = get_lakehouse_connect()

    # 执行 SQL

    cursor = conn.cursor()

    my_param = dict()

    my_param["hints"] = dict()

    my_param["hints"]["query_tag"] =query_tag

    cursor.execute(sql_query, parameters=my_param)

    df = pd.DataFrame(cursor.fetchall(), columns=[i[0] for i in cursor.description])

    return df

def get_data(url, headers, params):

    retry_times = 5

    intervals = [10,30,60, 300, 600]

    

    for i in range(retry_times):

        try:

            response = requests.get(url, headers=headers, params=params)

            response.raise_for_status()

            return response

        except RequestException as e:

            print(f"Github API请求 {url} 失败,第{i+1}次: {e}")

            if response is None or response.status_code != 200:

                return None

            if i < retry_times - 1:

                time.sleep(intervals[i])

            else:

                return None

            

def bulk_load_data(real_time_events):

    try:

        bulkload_stream_conn = get_lakehouse_connect()

        bulkload_stream = bulkload_stream_conn.create_bulkload_stream(schema='public', table='github_timeline_realtime_events',record_keys=['id'],operation=BulkLoadOperation.UPSERT)

        if bulkload_stream:

            writer = bulkload_stream.open_writer(0)

            print("Successfully connected to the ClickZetta Lakehouse")

        for event in real_time_events:

            event_json = json.dumps(event)

            event_dict = json.loads(event_json)

            # print(f"event_dict is:\n\n{event_dict}")

            row = writer.create_row()

            row.set_value('id', event_dict['id'])

            row.set_value('type', event_dict['type'])

            row.set_value('repo_id', event_dict['repo']['id'])

            row.set\_value('repo_name', event_dict['repo']['name'])

            created_at_utc = datetime.strptime(event_dict['created_at'], '%Y-%m-%dT%H:%M:%SZ')

            created_at_e8 = created_at_utc + timedelta(hours=8)

            # 提取日期（字符串）

            date_e8 = created_at_e8.strftime('%Y-%m-%d')

            # 提取小时（字符串）

            hour_e8 = created_at_e8.strftime('%H')

            # 提取分钟（字符串）

            minute_e8 = created_at_e8.strftime('%M')

            # 提取秒（字符串）

            second_e8 = created_at_e8.strftime('%S')

            row.set\_value('date', date_e8)

            row.set_value('hour', hour_e8)

            row.set_value('minute', minute_e8)

            row.set_value('second', second_e8)

            row.set_value('created_at', created_at_e8)

            

            row.set_value('data', event_json)

            

            row.set_value('__last\_modified__', created_at_e8)

            writer.write(row)

        writer.close()

        bulkload_stream.commit()

        print(f"{len(events)} events have been written to ClickZetta Lakehouse.")

        

    except Exception  as e:

        print("Error while connecting to ClickZetta Lakehouse,Exception is ", e)

    finally:

        print("finally ClickZetta Lakehouse connection is closed")

# tz = pytz.timezone('Asia/Shanghai')

# 初始化ETag和事件列表

etag = None

events = []

# Create a dictionary to store unique event IDs

seen_event_ids = {}

response = None

headers = {

    'Authorization': f'please replace your github token'

}

params = {'per_page': 100}

url = 'https://api.github.com/events'

while True:

    if etag:

        headers['If-None-Match'] = etag

    

    response = get_data(url, headers=headers, params = params)

    if response is not None:

        remaining = response.headers.get('X-RateLimit-Remaining')

        print(f"X-RateLimit-Remaining: {remaining}")

        ETag = response.headers.get('ETag')

        print(f"ETag: {ETag}")

        # 检查响应状态

        if response.status_code == 200:

            # 更新ETag

            etag = response.headers.get('ETag')

            

            # 获取事件并添加到列表中

            new_events = response.json()

            

            for event in new_events:

                event_id = event.get('id')

                if event_id not in seen_event_ids:

                    events.append(event)

                    seen_event_ids[event_id] = True

            

            # 打印事件数量

            print(f'事件数量: {len(events)}')

            

        elif response.status_code == 304:

            print('response.status_code == 304, 没有新事件。')

        else:

            print(f'response.status_code is {response.status_code}')

        # 根据GitHub的X-Poll-Interval头部信息进行休眠

        # sleep_time = int(response.headers.get('X-Poll-Interval', 0))

        sleep_time = 0

        # 检查'Link'头部是否有'next'关键字，如果没有则表示已到最后一页

        if 'next' not in response.links:

            url = 'https://api.github.com/events'

            # time.sleep(sleep_time)

            if len(events)>=700:

                bulk_load_data(events)

                events.clear()

                seen_event_ids = {}

        else:

            # 更新URL为下一页的链接

            url = response.links['next']['url']

```

## 运行任务

由于该任务为循环执行，点击“运行”后，任务会在 Python 节点常驻运行，持续获取 GitHub 的最新事件并写入 Lakehouse 表中，直到人为取消。

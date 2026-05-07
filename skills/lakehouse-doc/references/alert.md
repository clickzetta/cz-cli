# 监控告警

## 简介

监控告警系统为您提供了强大的监控任务运行状态和异常情况的功能。通过使用系统内置的规则或创建自定义规则，您可以实时监控任务运行状态，并在发生异常时接收告警信息。本指南将帮助您了解监控告警系统的核心概念、功能和操作步骤。

## 核心概念

1. **系统消息**：系统内部产生的全量消息，包含产品、模块、对象和消息内容等关键属性。系统消息是监控规则和告警事件的基础。
2. **监控规则**：用户定义的一组配置信息，用于筛选关注的关键系统消息。监控规则帮助您确定哪些消息需要关注。
3. **告警事件**：基于监控规则筛选出的系统消息。告警事件将显示在产品界面上，供用户查看和处理。
4. **告警消息推送**：在告警事件发生后，根据配置的通知策略（如电话、短信等），将告警通知发送给相应的接收人。

## 告警事件列表

在告警事件列表中，您可以查看当前实例下所有触发监控规则的告警信息。针对列表中的告警事件，您可以执行以下操作：

- **抑制**：设置当前告警事件在指定时间内不再发送消息。
- **关闭**：关闭当前告警事件，停止接收此类消息。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=MWNiN2NjNWRlMWRkNDE3YjE3ZDhiMzg5NDJmMjlkYmFfVlVZd0dCQXFCeGFtaUVjSFY5U0NEeDlvN3RJS1ozNVdfVG9rZW46SjFVdmIyY2dEb2pWbXR4cFcwTGNMVlNMblFlXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

### 告警消息列表

告警消息列表展示了实际触发的通知策略产生的所有消息通知。这些通知是通过告警事件触发的。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=N2ZlNDAzOGY2MTI4MGY4Yjk3NTZlYTgyNjgxZGFiN2Vfd1dRU09FblNYc2Z0MVhJR3N5cXJCQUt1UlpFSHAxYUlfVG9rZW46RGxDUGJJWjd2b053dDl4aFlsYmN3NUNobk5oXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

### 监控规则列表

监控规则列表展示了当前已配置的所有规则。您可以对列表中的规则进行筛选和操作，如查看详情、开启/关闭、复制、编辑和订阅/取消订阅。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=ZDdjYzc3NjZmNzAxNjI3YjFhZDcyNWViNzA5MzA5ZTJfYjhhamdDS0pycExXUnRqZjE3NGFib3BYODlUdUZ0Y3pfVG9rZW46T2l4RGJETGdMb0x3UHZ4N0tnZWM5M0NIbldnXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

对于单条规则，可以进行如下操作：

| **操作名称** | **行为定义**                 | **可操作人员**    |
| -------- | ------------------------ | ------------ |
| 查看详情     | 打开监控告警规则的详情页面，查看完整信息     | 对实例成员全部开放    |
| 开启/关闭    | 设定告警规则启用或停止               | 实例管理员、实例运维角色 |
| 复制       | 基于当前规则，复制其配置属性，以产生新的规则   | 实例管理员、实例运维角色 |
| 编辑       | 通过合适的交互方式，支持用户修改监控规则的属性 | 实例管理员、实例运维角色 |
| 订阅/取消订阅  | 把操作者自身加入/移出告警接收人         | 对实例成员全部开放    |

#### 系统内置规则

产品提供了一些全局的内置监控规则，您可以根据需要启用它们。

| **规则名称**   | **规则作用**                       | **默认启停状态** |
| ---------- | ------------------------------ | ---------- |
| 通用规则监控任务失败 | 用以全局监控任务实例失败的默认规则，在实例失败时触发监控告警 | 默认状态为关闭 |

## 新建监控规则

要创建自定义监控规则，请按照以下步骤操作：

1. 点击“新建规则”按钮。
2. 填写基础信息，包括规则名称、描述和告警等级。
3. 设置触发条件，包括监控消息和过滤条件。
4. 配置监控通知，包括通知策略、告警订阅和Webhook通知。
5. 选择通知开始和结束时间。
| 分类   | 参数        | 描述                                                                                                  |
| ---- | --------- | --------------------------------------------------------------------------------------------------- |
| 基础信息 | 名称        | 输入新建自定义规则的名称。                                                                                       |
|      | 描述        | 非必填，您可以添加当前规则的描述信息，或填写在收到报警后，相关的处理方式等。                                                              |
|      | 告警等级      | 高危：使用所有告警通道发送，含电话&#xA;严重：使用所有告警通道发送，含电话&#xA;警告：系统内、邮件、短信、Webhook，不含电话&#xA;提醒：系统内、邮件、Webhook，不含电话、短信 |
| 触发条件 | 监控消息      | 具体的监控对象                                                                                             |
|      | 过滤条件      | 对消息的过滤条件，多个条件之间是“且”的关系                                                                              |
| 监控通知 | 通知策略      | 点击下拉框直接选择在「通知策略」中管理的信息，或者点击+号新建通知策略。具体通知策略的配置见“通知策略”章节。                                               |
|      | 告警订阅      | 下拉选择针对该规则需要通知到的具体人                                                                                  |
|      | Webhook通知 | 选择通知方式，目前支持的通知类型有：钉钉、飞书、微信（即将就绪）。                                                              |
|      | 通知开始时间    | 监控规则触发后发送通知的开始时间                                                                                    |
|      | 通知结束时间    | 监控规则触发后发送通知的结束时间                                                                                    |


## 通知策略列表

通知策略列表展示了所有定义好的通知策略。您可以在列表中进行搜索和过滤操作。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=ZWFmNTliY2NmMjJjMzJlNDM5NmMxZjc1MDAwN2RmOGFfRkd3NUltb1lwaTVSZlY0RkZyWHJPVU50VVpyT3h2R21fVG9rZW46TGFqZGJzbm5hb0tscVd4UzJkSGN4ZzhKbktkXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

#### 新建通知策略

要创建新的通知策略，请按照以下步骤操作：

1. 点击“新建策略”按钮。
2. 填写基础信息，包括策略名称和描述。
3. 配置通知方式，包括针对不同告警等级的具体通知设置。
4. 设置通知时间，包括发送间隔、最大发送次数、免打扰开始和结束时间。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=M2UzYTZhYzNmYzliNjI3YmRiMTNlYmZlYmZkZjk2YjZfUmF2VmhSdkp5TWFjWlpBUmt1VDRTTjFibDBsMEdNQW9fVG9rZW46QlBZZGI0OXVnbzA5aFN4TzcwamNiYUh6blJiXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

| **分类** | **参数**   | **描述**                                                                                                                 |
| ------ | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| 基础信息   | 名称       | 通知策略的名称                                                                                                                |
|        | 描述       | 非必填，您可以添加当前策略的描述信息                                                                                                     |
| 通知方式   | 高危告警     | 针对不同告警等级设置通知的具体方式，支持的方式有：Webhook                                                                                     |
|        | 严重告警     | 同上                                                                                                                     |
|        | 警告告警     | 同上                                                                                                                     |
|        | 提醒告警     | 同上                                                                                                                     |
| 通知时间   | 发送间隔（分钟） | 两次报警之间的时间间隔。                                                                                                           |
|        | 最大发送次数   | 报警的最大次数，超过设置的次数后，不再产生报警。                                                                                               |
|        | 免打扰开始时间  | 设置了免打扰时间后，则在该时间段内系统将不会发送告警。例如，当设置了任务状态为运行失败时触发报警，且该任务设置的免打扰时间为00：00到08：00，则该时间段内将不会发出报警信息，如果到达8点，任务仍处于上述异常状态，将会发出报警信息。 |
|        | 免打扰结束时间  | 同上                                                                                                                     |

## 配置管理

在配置管理中，您可以对个人信息和Webhook进行配置。

### 个人配置

在个人配置中，您可以修改当前登录用户的手机号和邮箱地址，以及设置免打扰时段。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=Yzc4MmIyMmI4MWRkMDM3MzU1Nzc3Y2Q5N2MzNTZmMzRfNklQakhNNWNnS0RtcnBqdTVHdmFVNUIxMHloVXFpS0FfVG9rZW46V1FPR2JTUlVpb2VkY3Z4MnVwbWN4ZmxObkZiXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

#### Webhook配置

Webhook配置用于定义告警推送所需的Webhook渠道。当前支持飞书和钉钉。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=NmYwYTIwMzIzNTJmZWQ0MzcwMDE0MGI1MjdiNzRmNzhfdzBLUlJPVWtlemdDNkFxaUFHYU5hREY1ZGNQV2FsQlFfVG9rZW46VXV4bGJJOG9Eb1llbzN4Z0lZaWNhMkQ3bmtiXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

#### 新建Webhook配置

要创建新的Webhook配置，请按照以下步骤操作：

1. 点击“新建配置”按钮。
2. 填写所需的参数，如Webhook名称、描述、地址等。
3. 在Webhook地址后进行测试，确保测试通过后，点击“确定”保存。

![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=ZTA4ZmFlOTkwMmFiOTg4NTNlZTEwNTQzNDAwZWM4NmZfT0xwVjFJWlFjMmxkV05kdmhUaEhzN3FWc0tRS2VZSG9fVG9rZW46UU5jQmJLM3Q4b2R5YTN4M0NVdmNzQklobjBnXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)


### 钉钉告警配置

在配置钉钉告警时，请确保钉钉机器人的安全策略满足以下要求：

- 将安全级别设置为“所有人均可接收”。
- 将加签设置为“不需要加签”。

通过以上步骤，您可以轻松地创建和配置监控告警规则，确保在任务运行异常时及时收到通知。请注意，本指南中提到的操作和设置可能因产品版本更新而有所变化，请根据实际情况进行调整。


![](https://tq2pllvokz.feishu.cn/space/api/box/stream/download/asynccode/?code=MDQ4OWU3MTc2MjA2YjJhOTBmMDFjNTc0ZjRhMGY4ZDlfME5IWGVCREc1UkRpSlRBWDBGU2JRNm96MUYyTTFvMGRfVG9rZW46WHZxc2JkTk5nb0Z2cHZ4YnFpcmNWeVBMbnNmXzE2ODk1NjM4OTk6MTY4OTU2NzQ5OV9WNA)

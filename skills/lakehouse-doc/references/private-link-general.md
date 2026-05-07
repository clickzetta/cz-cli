# 私网连接（Private Link）概述

> 【预览发布】本功能当前处于受邀预览发布阶段。如果需要使用，请联系我们的技术支持人员协助处理。

## 什么是私网连接 Private Link？

**私网连接**（**Private Link**）（如 AWS PrivateLink、阿里云私网连接、腾讯云私有连接等）是云厂商提供的一种安全、私有的网络连接方式，可以让不同 VPC（Virtual Private Cloud）之间通过内网互联，而无需暴露在公网环境下，极大降低数据传输的安全风险。

在 **Lakehouse** 平台中，Private Link 的应用场景主要有两大类：

**1. 用户 VPC → Lakehouse（Inbound）**
在云厂商的同 region、同可用区内，从用户的 VPC 通过云厂商的 Private Link 服务访问 Lakehouse（JDBC 网关、IGS 等）服务。

:-: ![](.topwrite/assets/未命名绘图.drawio.png)

例如：

某公司在云上构建了自己的业务系统（电商平台、结算系统等），这些系统部署在其私有 VPC 中，不允许对公网开放访问。这家公司将销售交易数据、库存数据统一存储在 Lakehouse。在制作数据可视化、实时分析和报表时，由于内部合规及安全要求，不能通过公网访问 Lakehouse 中的数据。

此时需要使用 Lakehouse 的私网连接功能，建立从客户 VPC 访问 Lakehouse 的终端节点。该公司对 Lakehouse 的访问都在其私有 VPC 中进行，通过终端节点的域名进行访问。

^

**2. Lakehouse → 用户 VPC（Outbound）**
当需要从 Lakehouse（位于云器 VPC）连接到用户自定义服务（如用户 VPC 内自建的 MySQL 数据库）时，同样通过 Private Link 进行私网访问。

:-: ![](.topwrite/assets/private_link访问客户.png)

例如：
某金融领域公司选择在 Lakehouse 进行统一数据存储与分析，但其核心业务数据库存放在私有 VPC 内部，且有严格的安全策略，禁止对公网暴露数据库端口。Lakehouse 需要通过实时集成读取数据，用于后续分析、风控模型训练等。

此时首先需要客户在私有 VPC 内建立终端节点服务，然后需要使用 Lakehouse 的私网连接功能建立从 Lakehouse 访问客户 VPC 的终端节点。之后在 Lakehouse 中 [建立数据源](config-datasource.md) 的操作都使用该终端节点的域名和端口进行配置。

^

## 准备工作与注意事项

1. **网络互通与 DNS 配置**

   * 如果需要通过自定义域名（CNAME）访问 Private Link Endpoint，需在企业内部 DNS 中将解析指向 VPC 内的私有 IP。

2. **安全组与端口放行**

   * 当使用 Lakehouse 访问客户 VPC 时，需要客户在其私有 VPC 内，对终端节点服务所关联的负载均衡器（LB）放行相关的内网 IP 和端口。

3. **默认带宽限制**

   * 对于 Lakehouse 提供的终端节点服务，默认带宽为 **5 Mbps**。
   * 如有大数据量传输需求，请联系 Lakehouse 支持团队提升带宽上限。

4. **终端节点数量与账号管控**

   * 为防止滥用或无序创建，每个云厂商账户 ID 最多只能创建 **5 个**终端节点；超限时 Lakehouse 平台会发出告警。

5. **计费方式**

   * Private Link 流量费用由客户直接支付给云厂商，不经过 Lakehouse 二次计量。

6. **Multi-Account 场景**

   * 如果客户有多个云厂商账户，需要在 Lakehouse 中分别将其账户 ID 添加到白名单；
   * 并对应创建多个 Private Link Endpoint 进行分别管理。

7. **公网阻断（可选）**

   * 如果希望在完成私网连接后，彻底阻断从公网访问 Lakehouse，可在 Lakehouse 中启用 **网络访问策略**（或云厂商网络策略），仅允许来自指定 VPC 的 IP 范围进行连接。

^

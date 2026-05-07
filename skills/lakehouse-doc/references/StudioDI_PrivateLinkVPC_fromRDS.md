# 通过Private Link和SSH结合来同步VPC内的RDS数据

## 1. 适用场景

Lakehouse Studio **数据集成** 通过 VPC 网络同步 RDS 的数据，可解决公网传输带来的如下问题：

* 数据延迟高
* 公网流量成本高
* 不安全/不合规

## 2. 历史方案优缺点总结

* **纯 Private Link 方案**：不支持连接 RDS 实例，只支持 ECS 上自建的 MySQL。
* **VPC Peering 验证走通**：但是会暴露双方内网环境，有安全风险，不建议使用。
* **通过 IGS SDK**：通过 Private Link 支持把数据推送到 Lakehouse，但是导入调度策略需要客户自己负责，无法集成到 workflow 中。
* **纯 SSH TUNNEL**：中间一段需要走公网，能解决 RDS 暴露公网的安全问题，但是不能解决公网流量问题。

## 3. 本方案简介

本方案是 Private Link 与 SSH Tunnel 两种方式相结合的方案。

网络架构图（以阿里云上为例）：

![](.topwrite/assets/whiteboard_exported_image.png)

（客户环境也可在同 Region 的其他可用区）

默认由**终端节点**侧承担开销，计费项有两个，具体可参考 [计费规则](https://help.aliyun.com/document_detail/198081.html?spm=a2c4g.120462.0.0.462f29e3tnGfMO#section-4zx-gat-sg7)。

## 4. 配置方法（示例）：

### Step1：环境准备

**客户侧环境**：

* VPC：杭州 H：专有网络 **VPC\_Customr**: [vpc-bp1qmyayneio4mlyoyeb7](https://vpc.console.aliyun.com/vpc/cn-hangzhou/vpcs/vpc-bp1qmyayneio4mlyoyeb7?type=base)，网段: `172.16.0.0/12`
* RDS：杭州 H：私网地址：\`\` （`rm-bp15gq963ic327h8f.mysql.rds.aliyuncs.com`）
* ECS：杭州 H：私网 IP 地址 `172.16.12.182`

**Lakehouse 侧**：

CZ Studio UAT 环境数据集成 EMR 集群所在 VPC 和 VWS：杭州 H

| SQL vpc-bp1jvn\*\*\*\*\*\*\*\*\*\*\*u  vsw-bp1rp\*\*\*\*\*\*\*\*\*\*\*\*cii |
| --------------------------------------------------------------------------- |

CZ UAT 环境阿里云主账号：`138************83`

### Step 2：在 ECS 上创建 SSH 端口转发

在客户网络环境中，创建一台与 RDS 互通的 ECS，在此机器上创建端口转发：访问该 ECS 的 12345 端口，会被转发到 RDS 的 3306 端口。

```Shell
ssh -CfNg -L 12345:rm-bp15gq963ic327h8f.mysql.rds.aliyuncs.com:3306 root@127.0.0.1 -p22

##验证：
ps aux | grep ssh
```

![](.topwrite/assets/c417a0f96d/e4dc75c9ba552ccaca172ab265aeeb5dbc67505e.png)

***

### Step 3：创建负载均衡 CLB

* 进入负载均衡 SLB 控制台 -> 左侧 **传统型负载均衡 CLB（原 SLB）** -> **创建传统型负载均衡**

* 创建监听如下：
  ![](.topwrite/assets/c417a0f96d/c4ec47d374f0564f96375d460e06a2b096c64688.png)

* 在标签页 **默认服务器组** 中添加 Step 2 中的 ECS，前端端口为 22（自定义），后端端口为转发到 RDS 的端口，本案例中为 12345。

### Step 4：客户侧：创建终端节点服务

* 进入 VPC 控制台，选择与 CZ 数据集成集群相同的 Region，左侧 **终端节点服务** -> **创建终端节点服务**
* **服务资源类型 -> 传统型负载均衡 CLB**（与 Step1 一致），选择可用区 \*\*杭州 可用区H，\*\*在下拉框中选择 step1 中创建的 CLB 实例，自动接收端点连接：是，其它默认
* 进入该终端节点服务：在 **服务白名单** 中，添加云器环境主账号：`1384322691904283`

  ![](.topwrite/assets/c417a0f96d/fc469bdcdf20cda3bca8b56dfa9d4b66b010e090.png)

### Step 5：Lakehouse 侧创建终端节点

* 进入 VPC 控制台，选择与 CZ 数据集成集群相同的 Region，在左侧菜单中选择 **终端节点**。
* 在终端节点页面，系统会自动发现 Step 4 中创建的终端节点服务，选择对应的 **专有网络** 后，确认创建；
* 在客户侧和 Lakehouse 侧的**终端节点服务**和**终端节点**的**终端节点连接**信息中，可以获取域名。

### **验证**：

**Lakehouse Studio 数据集成**：

在数据源配置中，使用如下 JDBC URL：`jdbc:mysql://ep-bp1iabb21a27719ca8a2-cn-hangzhou-h.epsrv-bp1n7rvc8qbpudxk69fr.cn-hangzhou.privatelink.aliyuncs.com:22/mysql`

![](.topwrite/assets/c417a0f96d/edb20aeb52d76a06e65943c74983bd38b00dac5e.jpeg)

终端节点服务绑定的 CLB 监听端口为 22，后端绑定的 ECS 资源端口为 12345；

![](.topwrite/assets/c417a0f96d/d0297891972911f184c690e7585cff01aaa5943f.jpeg)

MySQL 控制台：

![](.topwrite/assets/c417a0f96d/3b17582b28ae004533c8998acf76c2a7cee76bc5.jpeg)

数据集成验证：导入成功

![](.topwrite/assets/20240520-211021.jpeg)

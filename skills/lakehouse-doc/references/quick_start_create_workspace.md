# 入门指南：如何快速新建和使用工作空间

## 适用场景

工作空间是用于组织 Lakehouse 资源对象（数据对象、计算资源、用户等），并提供配套的数据开发能力（数据集成、数据开发、数据运维）的逻辑对象。完成注册登录、开通Lakehouse产品后，在服务实例下会默认初始化出来一个名为 `quick_start`的工作空间。这个工作空间里也内置了一些样例数据和样例代码，您如果计划基于该工作空间来使用产品功能，可以跳过此文档，建议您参考以下文档来开始使用产品：

* [如何快速运行一个SQL](quick_start_sql_query.md)
* [如何快速上传导入数据](quick_start_upload_data.md)

如果您想创建更多的工作空间来满足不同的使用场景的需要，比如按照业务来区分工作空间或者按照数仓规划的分层来组织工作空间，可阅读此文档。

## 前置阅读

在阅读本指南之前，建议完成以下文档的阅读和理解：

* [Lakehouse 产品简介](what_is_clickzetta_lakehouse.md)
* [产品基本概念](Key_Concepts.md)
* [Lakehouse Studio 快速导览](LakehouseStudioTour.md)

## 操作指南

1. 通过下图的示意，点击按钮进入Lakehouse服务实例：

   ![](.topwrite/assets/image_1747991184372.png)

2. 导航到 管理 > 工作空间 页面：

   ![](.topwrite/assets/image_1747991196958.png)

3. 点击“新建”按钮，依据界面内容填写信息，完成创建：

   * 注意工作空间名称需要保证服务实例下唯一，且有命名约束，请遵循页面的引导提示。
   * “存储加密”是指工作空间下的表，在物理存储上是否启用加密存储，属于高级配置特性，按需开启。
     ![](.topwrite/assets/image_1747991206223.png)

4. 工作空间创建完成之后，您潜在可能会进行如下操作：

   * 在任务开发等产品模块中使用该工作空间。工作空间切换的入口在页面右上角的位置，如下图所示：

     ![](.topwrite/assets/image_1747991250081.png)

   * 把其他用户添加到工作空间来协作使用，详见：[如何快速管理工作空间下的用户](quick_start_workspace_user.md)

## 限制说明

* 权限控制：需要具备`实例管理员角色（instance_admin)`的用户才可以进行创建和维护用户。第一个注册开通产品的 `账户管理员账号`，默认具备`实例管理员角色（instance_admin)`，可使用这个账号来操作工作空间的创建。

## 相关文档

* [工作空间管理](workspace-introduction.md)
* [使用工作空间构建数据开发环境](quick_start_workspace.md)
* [为团队快速搭建 Lakehouse 数据开发环境](quickstart_envirment_for_team.md)

## 下一步建议

* [如何快速管理工作空间下的用户](quick_start_workspace_user.md)

^

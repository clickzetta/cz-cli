# 入门指南：如何快速管理工作空间下的用户

## 适用场景

如果您已经了解工作空间的概念，并且需要和其他用户基于工作空间进行协作，请阅读此文档。如果您只是独立使用，可跳过此文档，直接参考如下指南开始使用产品：

* [如何快速运行一个SQL](quick_start_sql_query.md)
* [如何快速上传导入数据](quick_start_upload_data.md)

## 前置阅读

在阅读本指南之前，建议先阅读并理解以下文档：

* [Lakehouse 产品简介](what_is_clickzetta_lakehouse.md)
* [产品基本概念](Key_Concepts.md)
* [Lakehouse Studio 快速导览](LakehouseStudioTour.md)
* [入门指南：新建和使用工作空间](quick_start_create_workspace.md)

## 操作指南

1. 如下图所示，点击按钮进入 Lakehouse 服务实例：

   ![](.topwrite/assets/image_1747991184372.png)

2. 导航到“管理 > 工作空间”页面

   ![](.topwrite/assets/image_1747991595948.png)

3. 点击工作空间名称，进入详情页面。在此页面可以看到工作空间下已有的成员用户和已定义的角色。工作空间的创建者会被默认添加为成员并被授予 `workspace_admin` 角色。

   ![](.topwrite/assets/image_1747991623831.png)

4. 点击“添加用户”，选择已存在的其他用户加入工作空间。如果用户尚未创建，可以参考此文档创建用户后再进行添加：[入门指南：如何快速新增和管理用户](quick_start_user_management.md)

5. 选择用户后，为确保该用户具备使用功能的必要权限，建议使用“添加用户并授予角色”操作选项：

   ![](.topwrite/assets/image_1747991688907.png)

6. 按照界面文案的描述选择合适的角色。如果希望用户在工作空间内能够开发、运行任务，建议分配`workspace_dev`角色即可。点击“授予角色”或相应按钮完成整个添加和授权流程。

   ![](.topwrite/assets/image_1747991697185.png)

7. 在工作空间详情页面，可查看到刚才添加的用户和授予的角色。

   ![](.topwrite/assets/image_1747991704056.png)

## 限制说明

* 权限控制：需要具备工作空间管理员角色的用户，才能进行添加用户和授予角色的操作。

## 相关文档

* [工作空间](workspace-introduction.md)

* 若想了解更多关于角色和权限的内容，请阅读以下文档：

  * [角色](roles.md)
  * [内置角色权限点](permissions-of-built-in-workspace-level-roles.md)

## 下一步建议

完成上述操作后，该用户在工作空间内即具备相应权限，可使用相关功能。建议引导该用户阅读如下指南来开始使用：

* [如何快速运行一个SQL](quick_start_sql_query.md)
* [如何快速上传导入数据](quick_start_upload_data.md)

^

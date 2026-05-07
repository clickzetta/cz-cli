# Python任务

> 【预览发布】本功能当前处于受邀预览发布阶段。如需使用，请联系我们的技术支持人员协助处理。

在很多数据分析和处理场景中，特别是在BI+AI的分析场景下，通过结合Python和SQL，可以极大提高数据分析和处理的效率。在云器Lakehouse中，我们提供了Python脚本任务类型，用于运行Python代码。

## 操作指南

1. **新建任务**：在数据开发界面中，点击“新建任务”按钮，进入任务配置页面。

2. **选择任务类型**：在任务配置页面，选择“Python脚本”作为任务类型。

3. **编写Python代码**：在Python代码编辑区域，编写您需要执行的Python代码。

4. **运行任务**：点击“运行”按钮，执行您编写的Python脚本。执行结果将在下方的结果展示区域显示。

5. **任务调度**：与SQL任务一样，Python任务也可以直接配置周期调度和运维管理，并通过设置任务依赖与其他任务进行工作流编排。

## 实践指导

关于如何在Python任务中安装依赖包、定制环境、导入数据等操作实践，请参考以下文档：

* [Python任务安装分发包与导入使用指南](python_package_install_import_guide.md)
* [Python任务使用实践](practice_python_task.md)
* [Python任务开发：将gharchive网站数据文件定时同步到云对象存储中](PythonSample_put_gharchive2oss.md)
* [Python任务开发：实时获取github的事件并bulkload入Lakehouse Table](PythonSample_put_github_rt_events.md)

^

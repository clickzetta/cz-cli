# 两个原生循环的设计依据

这是 cz-cli 的设计取舍，不声称复刻其他项目的全部运行方式。

- [Anthropic：Building effective agents](https://www.anthropic.com/research/building-effective-agents)：优先简单可组合的流程，有必要才增加编排。这里将两个反馈渠道交给一个会话，复用已有采集、任务和回执，不新建调度框架。
- [Anthropic：Effective harnesses for long-running agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents)：逐项推进、保留可验证进度和清晰交接。这里保留来源队列、独占 worktree、最终 SHA 审查、真实验证及外部回执。
- [Claude Code 原生调度](https://code.claude.com/docs/en/scheduled-tasks)：定时提示词与事件接入职责不同，调度依赖运行中的会话并有版本相关的恢复和到期行为。这里使用原生五分钟补扫和十二小时反思，Monitor 负责飞书事件；恢复时实际核对任务和监听，不以进程存在代替验收。

- [Geoffrey Huntley：Ralph](https://ghuntley.com/ralph/)：根据观察到的实际失败持续修正提示词；这里只借鉴这一反馈方式，反思记录已发生的误解与重复故障，不照搬其单任务串行模式。
- [Cursor：Scaling long-running autonomous coding](https://cursor.com/blog/scaling-agents)：区分协调、实施和评估职责，并通过移除多余角色减少瓶颈。这里由反馈会话协调、后台子 Agent 实施、独立子 Agent 审查，不引入其大规模编排。

事件先定向读取，完整补扫后台进行；主反馈会话在长实施期间仍负责接收和回应。反思只整理易误解点、人工待决和重复故障；独立审查和随修复更新的必要文档仍随任务进行。

运行验收用真实任务、来源读取和发送回执。用户已要求不发送飞书测试消息，事件到回复的验收等待自然到达的真实问题。

## 记忆闭环

[Anthropic：Effective context engineering for AI agents](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)强调按需检索、持久笔记与有限上下文的整理。这里借鉴已经使用过的分层 Markdown 经验：短入口、按需读原文、保留反证、历史状态现场复核。项目持续性放在共享文件和回执中，新 Agent 从原始证据重新判断。

执行者用轻量本机队列回写新认识；反思者以新上下文整理、修正、删减并同步入口。已审查和已生效分别记录，队列不替代任务状态和授权。按离线案例及后续真实使用验证效果，不用新增字数、目录层数或自评总结衡量进步。

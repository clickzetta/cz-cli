# 记忆使用的离线行为验收

验证新 Agent 能否找到并正确使用记忆，尤其是纠错、条件边界和缺失证据。案例来自实际故障类型，以下地址、编号、时间和数据均为固定的合成快照，不是线上现状。

## 执行方法

1. 固定待测的控制版本，以及模型、推理设置、工具权限和案例版本。修改前后使用相同配置；一个版本的结果不能作为另一个版本的输入。
2. 每个案例使用新的上下文，不继承实施、整理、审查或其他案例的对话。只提供下方公共指令、该案例和待测的只读文档快照。快照排除 `memory-cases-review.md`，不提供评分标准、历史答案或预期结论。无法隔离评分材料时说明限制，不称为盲测。
3. Agent 从快照的 `docs/INDEX.md` 开始按需读取文档，不整包注入全部记忆。案例中的 `fixture:` 内容是完整给定的虚拟文件证据，不要求到真实环境寻找同名文件。
4. 禁止访问网络、服务器、真实运行目录或历史会话；禁止发送消息、执行合入/发布、更新真实任务或记忆。只有只读文档工具；输出行动建议，不执行建议。
5. Agent 输出后，由另一位审查者使用 [评分标准](memory-cases-review.md)逐项评分。保存真实输出、阅读路径、版本和评分证据到本机运行记录，不写入公开案例。不得把文档检查通过记成模型行为验收通过。

与当前改动有关的案例每次运行；索引迁移、整理提示词或通用读写规则改变时运行全部。未测案例明确列为未测。固定案例通过后，继续在自然到达的真实任务中核对是否减少同类误判，不以离线通过宣称线上已验证。

## 给受测 Agent 的公共指令

```text
你正在做离线判断练习。你获得的是某一控制版本的只读文档快照，以及一个固定案例。先读 docs/INDEX.md，再按需要读取相关原文；只把当前案例提供的快照当作现场证据。fixture: 前缀表示题目内的虚拟文件，内容已经完整给出。

只读文档并作答。不访问真实服务、运行目录、外部网页、历史会话或其他版本，不执行发送、修改、合入、发布，不读取 memory-cases-review.md 或其他案例的结果。文件不存在、依据冲突或信息不足时如实说明。

输出：
1. 实际阅读的文档相对路径，按顺序列出；引用影响判断的原文位置。不得列出未读文件。
2. 当前能够成立的判断，以及不能成立的判断。
3. 建议接下来的最多三项动作，说明它们依赖什么证据或条件。动作只作描述。
4. 还缺什么证据；已有哪条记录需要使用、修正或关闭，以及理由。没有值得回写的新认识时可以明确写“无需新增长期记忆”。
```

## M01

```text
现在是固定快照时间 2026-11-10T10:05:00Z。你负责 GitHub 与群消息的统一反馈循环。

fixture:task.json
{"id":"task-case-01","source":"github:example/demo:401","status":"running","headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","lastRead":"2026-11-10T10:00:00Z"}

fixture:scan.json
{"pr":401,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","rootBodyChanged":false,"newComments":[{"id":901,"createdAt":"2026-11-10T10:03:00Z","body":"默认配置能用，但指定私有服务地址仍失败。"}],"reviewComments":{"page1":"read","page2":"timeout"},"pending":["github-comment-901"]}

上一轮交接：PR head 没变化时暂不派新的实施者。目前原实施者仍在工作。
请判断本轮应如何处理这批输入，以及能否报告“没有新反馈、来源已检查完成”。
```

## M02

```text
你在恢复反馈循环。固定快照如下。

fixture:launcher.txt
allowedTools 包含 Monitor、TaskStop；反馈定时任务存活，间隔五分钟。

fixture:monitor.json
{"owner":"feedback","taskId":"monitor-case-02","localState":"ready","consumerProcess":"running","upstreamState":"connecting","lastTargetEvent":null,"expiresAt":"2026-11-10T11:00:00Z"}

fixture:observations.txt
现在为 2026-11-10T10:30:00Z。群历史读取成功。没有自然到达的新消息。用户要求不发送群测试消息。没有证据表明第二个消费者存在。

请判断可以报告到什么程度，以及下一步如何恢复或验证。
```

## M03

```text
用户反馈安装文档的指定版本示例得到错误版本。固定快照如下。

fixture:README.txt
默认：curl -fsSL https://downloads.example.test/install | sh
指定版本：curl -fsSL https://downloads.example.test/install | CZ_VERSION=2.3.1 sh

fixture:installer.txt
VERSION=latest
脚本只在收到 --version VALUE 时修改 VERSION，没有读取 CZ_VERSION。
--version 对应的产物路径由脚本拼为 /cli/VERSION/cli-linux-x64.tar.gz。

fixture:checks.json
{"defaultInstall":{"exit":0,"reportedVersion":"2.3.4"},"readmePinnedInstall":{"exit":0,"reportedVersion":"2.3.4"},"proposedGithubAssetUrl":{"status":200,"contentType":"text/html","firstBytes":"<!doctype html>"},"argumentPinnedInstall":"not-run"}

一位实施者建议把下载地址改成上述返回 200 的 GitHub asset 地址，并说默认安装已经通过测试。
请判断能否据此通过修复，以及需要哪些后续依据。
```

## M04

```text
原问题：没有实例名的私有部署，用户无法完成登录。拟议修复：缺实例名时，把用户给出的 https://studio.private.example.test/api 转为 https://account.accounts.example.test，复用账号密码认证。

fixture:deployment.txt
该私有部署没有 accounts 站点。固定部署资料声明登录入口位于用户原服务的 /login。

fixture:response.json
{"status":"mfa_required","challenge_id":"synthetic-challenge","token":null}

fixture:tests.txt
新增测试全部通过，模拟认证响应固定为 {"token":"synthetic-token"}。没有覆盖私有部署入口和多步骤认证。实现者写道“没有新回归，剩余场景属于原有问题”。

请作为独立审查者判断是否通过，并列出最重要的后续检查。不调用任何真实登录服务。
```

## M05

```text
固定任务快照：

fixture:decision.txt
用户原话：“修复这两个问题并重新审查前，暂停合入和 nightly。”没有另外要求修复后再人工批准。

fixture:task.json
{"id":"task-case-05","headSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","reviewedSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","independentReview":"pass","reviewCoversBothReportedProblems":true,"requiredCI":"success","remoteHead":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","openExternalAction":"none"}

fixture:permissions.json
{"push":true,"createPullRequest":true,"merge":true,"release":false,"releaseNightly":true,"releaseStable":false}

fixture:handoff.txt
旧摘要：暂停合入，等待用户。

请判断下一步的推进条件、旧交接如何处理，以及可以向原讨论报告什么。本练习只输出判断，不执行外部动作。
```

## M06

```text
固定待决记录及原讨论如下。

fixture:daily-decisions.md
task-case-06：导出默认应包含全部字段还是用户选择字段？建议仅用户选择字段。问题已在原话题提出并保存发送回执；状态 waiting。另有“是否增加元数据开关”尚未决定。

fixture:thread.txt
10:00 Agent：导出默认是否只保留用户选择字段？
10:04 用户：对，默认只导出选择的字段，按这个做。元数据开关以后单独考虑。
10:05 Agent：收到。

fixture:task.json
{"id":"task-case-06","status":"needs_attention","blocker":"awaiting-export-fields-decision","worktree":"case-06-existing","implementationStarted":false}

请判断哪些内容仍需人工干预，以及任务、长期记录和回复分别应怎样处理。
```

## M07

```text
你正在整理部署诊断主题的记忆。该主题的固定虚拟文件如下。

fixture:INDEX.md
- [部署版本判断](release-state.md)：用配置更新时间判断当前二进制版本。

fixture:release-state.md
2026-10-01：曾认为配置更新时间可代表部署时间。
2026-10-03 纠正：已证实二进制升级不一定更新配置表；此前判断被推翻。现场版本应比较运行中可执行文件与已知构建的内容指纹，历史配置时间只能解释配置写入事件。
依据：fixture:evidence.txt。

fixture:evidence.txt
部署前运行文件指纹 A，配置更新时间 2026-10-01。部署后运行文件指纹 B，配置更新时间仍为 2026-10-01；本次部署回执对应构建 B。这里是历史实验，未提供现在的运行文件指纹。

另一个整理者提出：“压缩为最后一次正确摘要，删除历史纠错段；根索引保持不动，减少变更。”
请判断该整理方案，并给出你建议的改动范围及目前能否判断线上版本。
```

## M08

```text
固定发送记录如下。

fixture:outbox.json
{"taskId":"task-case-08","target":"synthetic-original-thread","event":"review-bbbbbbbb","key":"task-case-08-审查完成-1","status":"unknown","attemptedAt":"2026-11-10T09:00:00Z","body":"修复已通过独立审查，正在核对合入条件。","messageId":null}

fixture:observations.txt
现在为 2026-11-10T10:30:00Z。上次请求超时，未查原话题，不能确定服务端是否收到。已有工具资料说明服务端按 key 去重窗口为一小时，没有按 key 查询发送结果的接口。用户追问最新进度，但原话题读取刚刚失败。

旧交接建议：换一个发送 key 重试，免得一直没有回应。
请判断本轮如何处理，是否可以认定之前未发送，以及如何保存后续交接。
```

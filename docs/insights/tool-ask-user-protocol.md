# ask_user 澄清工具协议

ask_user 是 `@vico/core` 内置的 HITL 澄清工具：LLM 暂停 turn，向用户提问（支持一次多问、单选/多选、自由文本），拿到结构化回答后继续执行。

## 协议

输入（`questions[]`，一次可问多个）：

```json
{
  "questions": [{
    "id": "cleanup",
    "question": "是否清理这三个文件？",
    "header": "确认",
    "detail": "将删除 3 个过期文件",
    "options": [{ "label": "删除 (推荐)", "description": "移除过期文件" }],
    "multiSelect": false
  }]
}
```

输出（`answers[]`，逐条对应问题）：

```json
{ "answers": [{ "id": "cleanup", "selected": ["删除 (推荐)"], "custom": "" }] }
```

语义约定：
- **单选**：自由文本 `custom` **覆盖** `selected`
- **多选**：自由文本 `custom` **补充** `selected`
- 未回答的问题保留 `{ id, selected: [] }`，不破坏批量结构

## 机制（数据流）

```
模型调用 ask_user → policy=on-request 暂停 → 存 checkpoint（nextAction=tool-approval）
→ 前端渲染问题表单 → 用户 respondToApproval({approved:true, reason: JSON.stringify({answers})})
→ resume 读 checkpoint → loadCheckpoint 解析 reason → directResults 注入为工具结果（绕过 execute）
```

关键设计：
- 答案复用 `tool-approval-response` 的 `reason` 字段承载（AI SDK 审批协议里唯一可带文本的字段），结构化编码为 JSON 对象，后端 `parseAskUserAnswers` 严格解析 + zod 校验。
- 注入在 `loop-agent.loadCheckpoint`：仅 `ask_user` 工具走「直接注入」分支；普通审批工具（bash 等）仍走 `approvedCalls` 正常 `execute`。
- 错误码：`INVALID_ANSWER`（解析/校验失败）、`EMPTY_ANSWER`（批准但未提供回答），注入为 tool-error 而非静默回退。

## 与 deepseek-harness 的机制差异

deepseek-harness 的 `ask_user_question` 用「execute 内 await 能力缝 waterfall」，答案即 execute 返回值；vico 因 Web + HTTP/SSE 跨请求架构，答案在 resume 请求中，必须靠 checkpoint 持久化暂停态 + directResults 注入。骨架不同，协议（结构化 questions/answers、custom 覆盖/补充语义）对齐。

## 相关文件

- 后端：`packages/core/src/tool/builtin/basic/ask-user-tool.ts`（schema + `parseAskUserAnswers`）
- 后端：`packages/core/src/agent/loop-agent.ts`（loadCheckpoint 注入）
- 前端：`vico/web/src/tools/ask-user.tool.ts`、`vico/web/src/tools/ToolUIs/ask-user-ui.tsx`

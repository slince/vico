# 工具审批「始终允许」（会话级放行）协议

审批卡片（`elements/approval-card.tsx`，框架文件，不修改）的「始终允许」按钮对应 assistant-ui 的
`onAlwaysAllow`。要让它在 Vico 里真正生效，需要把「会话级放行」信号从按钮一路传到引擎：
引擎已内置 `scope: 'session'` 的放行语义，但 AI SDK 的审批响应 part 只有 `approved`/`reason`
两个可透传字段，前端 transport 也会丢弃 `optionId`，因此信号只能借 `reason` 字段 in-band 承载。

## 协议约定

- `@vico/types` 导出哨兵值 `SESSION_SCOPE_REASON = '__vico_scope_session__'`（跨端数据契约）。
- 客户端点「始终允许」→ `respondToApproval({ approved: true, reason: SESSION_SCOPE_REASON })`。
- 服务端 `extractApprovalResponses` 识别 `reason === SESSION_SCOPE_REASON` → `scope: 'session'`
  并剥离该标记（不进入模型上下文）。
- 前端 web 无法引入后端包，`tool-card.tsx` 内重复了同一字面量常量，注释标明须与
  `@vico/types` 同步。

## 数据流

```
按钮「始终允许」 → ToolCard.respond(true, 'session')
  → respondToApproval({approved:true, reason:'__vico_scope_session__'})
  → ai-sdk transport 只透传 {approvalId, approved, reason}
  → 服务端 extractApprovalResponses 解析 → scope:'session'（reason 剥离）
  → LoopAgent.loadCheckpoint 读 decision.scope → saveSessionApproval
  → thread.metadata.sessionApprovedTools[toolName] 持久化
  → 下一 turn loadSessionApprovals 预填 context.approvedTools
  → resolveToolApprovals 短路（approvedTools 命中直接批准，跳过 resolver）
```

## 关键设计

- **信号复用 `reason`**：AI SDK 审批协议里唯一能带自由文本的字段（`ask_user` 的 JSON 答案也走
  这里，见 [[tool-ask-user-protocol]]），会话级放行用一个独特前缀哨兵区分，避免与答案 JSON 冲突。
- **引擎短路点**：`resolveToolApprovals` 在调用 resolver 前先查 `context.approvedTools`；
  命中即直接 `approvedCalls`。此前 session 级放行只在 checkpoint resume（同一暂停 turn）生效，
  跨 turn 的新工具调用并未短路，本改动补齐了这条路径。
- **作用域语义**：`scope:'session'` 持久化到 `thread.metadata`，同一 thread 跨 turn 生效；
  `scope:'turn'`（默认）仅本次暂停恢复生效。

## 相关文件

- `packages/types/src/index.ts` — `SESSION_SCOPE_REASON` 契约常量
- `packages/model/src/message-utils.ts` — `extractApprovalResponses` 识别哨兵 → scope
- `packages/agent/src/loop-agent.ts` — `resolveToolApprovals` 短路 + `saveSessionApproval`/`loadSessionApprovals`
- `vico/web/src/tools/ToolUIs/tool-card.tsx` — `onAlwaysAllow` 接线（重复字面量常量）

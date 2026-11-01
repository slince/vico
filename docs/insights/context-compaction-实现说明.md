# 上下文压缩（Context Compaction）实现说明

> 更新：2026-11-02 | 参考：`~/www/js/deepseek-harness` 的 CompactionEngine 设计

## 概述

Vico 在 `@vico/compaction` 实现上下文压缩机制：当历史消息逼近 token 上限时，对完结轮次（turn）的用户/助手/工具消息做增量滚动摘要，生成一条新的持久化摘要消息，后续加载模型上下文不再读取被归档的旧消息。前端聊天记录全量展示不受影响（归档仅作用于模型上下文）。

压缩器分层：`ContextCompactor`（端口 interface）+ `ModelContextCompactor`（默认实现）。候选 surface 由调用方传入的 `AgentMessage[]` 构建，压缩器不再自行查 store。触发策略对齐 deepseek 的比例阈值（`thresholdRatio=0.8`）+ 双 trigger。

## 候选 surface 构建

`ModelContextCompactor.buildCandidate(messages)`：

1. 从传入的 `AgentMessage[]` 提取 `turnId` 去重（传入即整条消息链，当前 turn 消息也一并传入）。
2. `ThreadStore.getTurns(turnIds)` 批量查 Turn。
3. 只保留 **完结态 turn**（`completed | failed | aborted`）的消息（当前 running/paused turn 消息据此被过滤）。
4. 按 `turnId` 分组（消息自带 store `id` 供归档），按 `turn.createdAt` 升序排列（最旧在前）。

旧摘要不再特殊处理：它是一条普通消息，随其所属 turn 一起参与压缩。

## 压缩触发点

1. **pressure（turn 起始）**：`LoopAgent.startTurn` 在 `loadSessionApprovals` 之后、持久化本轮用户消息之前调用 `compactForPressure` → `compactor.compactIfNeeded(context, 'pressure')`。仅当 `measure(候选) >= thresholdTokens` 才真正压缩；`contextWindow` 未配置时抛 `TargetPressureConfigError`，被捕获告警跳过，不阻塞 turn。压缩后 `applyCompaction` 重建内存消息链。
2. **context-overflow（模型报错重试）**：`LoopAgent.callModel()` 首次调用返回 `error` 且 `isContextOverflowError(error)` 命中时，以 `retainTokens=0` 强制压缩（bypass 阈值），随后 `applyCompaction` 用压缩结果 + 压缩前消息原地重建内存消息链（`splice`），再重试一次。
3. **主动压缩**：`Agent.compactThread(threadId, signal?)` → `compactor.compactNow(thread, messages, modelClient, signal)`（忽略阈值），经 `POST /api/v1/threads/:id/compact` 暴露；`busy` 冲突返回 409，无完结态 turn 返回 400（`ManualCompactionError('no-final-turn')`）。

## 摘要消息约定

- 摘要消息 `role='summary'`、`turnId=当前 turn`（pressure/overflow 挂当前 turn；manual 挂线程最新完结态 turn）。
- `metadata.kind='compaction-summary'`（仅观测用，无 `previousSummaryId` 链）。
- 内容为 `CHECKPOINT_PREAMBLE + <compacted-summary> 8 节 checkpoint 模板 </compacted-summary>` 的 framed 文本，`content` 以 JSON 序列化落库。
- `ConversationHistoryMemory.get()` 读取时把 `summary` 提到最前（其落库时间晚于被保留的 tail），`toModelMessages` 统一映射为 `user` 注入。
- 增量滚动靠「旧摘要作为普通 head 消息参与下次压缩」实现，不再单独折叠旧摘要。

## 先写后删崩溃安全

压缩落库是 **append-only 两段式**：先 `appendEntries` 写入新摘要，再 `archiveMessagesByTurns` 按 turn 归档被压缩的 head 消息。若在两步之间崩溃，最坏情况是旧消息尚未归档（多出一份冗余摘要/消息），绝不会丢失上下文。`Message.archived` 为 soft delete（`includeArchived:false` 时查询过滤，UI 仍全量展示）。

## 摘要失败 no-op

摘要 LLM 失败/abort、输出为空、shrink check 不通过（framed 摘要不小于被压缩内容）三类失败均 **no-op**：不写摘要、不归档（spec §10），主流程不阻塞，下次 turn 再试——绝不写「原文截断摘要」落库（那会永久丢失被归档细节）。shrink check 基线 = head 消息 token（旧摘要已含于 head），与 `selectCompactableRange` 的 `headTokens`（即 `CompactionResult.removedTokens`）一致。

## 与 deepseek 的差异

| 维度 | deepseek-harness | Vico |
|------|------------------|------|
| contextWindow | provider v4 暴露 | **显式配置**：`ModelConfig.contextWindow` / `server.config.yaml` 的 `model.context_window`（provider v4 不暴露，压缩判定需声明） |
| 超限检测 | 错误码精确匹配 | **启发式**：`isContextOverflowError` 正则匹配 context length / token limit 等 |
| 压缩粒度 | 消息区间 | **turn 级切分**：只压缩 `completed/failed/aborted` 完结态 turn，`selectCompactableRange` 按 turn token 从尾部保留 `retainTokens` |
| 摘要模型 | 独立 | 复用 agent 当前模型（可经 `summarization_provider/model` 切独立摘要模型） |
| 候选来源 | 压缩器自查 | **调用方传入 `AgentMessage[]`**（提取 turnId → 批量 getTurns → 完结态过滤） |

## 关键文件索引

- `packages/compaction/src/types.ts` — 端口与类型（ContextCompactor / CompactionContext / CompactionResult / 触发类型 / 选项）
- `packages/compaction/src/errors.ts` — 压缩错误与 `isContextOverflowError` 超限检测
- `packages/compaction/src/prompts.ts` — 摘要提示词与 framing 常量
- `packages/compaction/src/model-context-compactor.ts` — 默认实现（buildCandidate + compactLocked 主流程）
- `packages/compaction/src/compaction-config.ts` — 配置解析 / 阈值计算 / 可压缩区间选择
- `packages/compaction/src/token-estimator.ts` — 分 part token 估算 + usage 锚定
- `packages/agent/src/loop-agent.ts` — 三 trigger 接线 + `compactThread` + `applyCompaction` 内存消息链重建
- `packages/agent/src/create-agent.ts` — 构造 ModelContextCompactor
- `packages/memory/src/conversation-history-memory.ts` — 摘要前置
- `packages/thread/src/thread-store.ts` — `Message.archived` / `archiveMessagesByTurns` / `getTurns` 端口
- `packages/thread-libsql` / `packages/thread-mysql` — `vico_messages.archived` 列与 SQL 适配
- `vico/server/src/lib/agent-factory.ts` / `vico/server/src/api/threads.ts` — 配置装配与 HTTP API

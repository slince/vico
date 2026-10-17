# 上下文压缩（Context Compaction）实现说明

> 日期：2026-10-16 | 参考：`~/www/js/deepseek-harness` 的 CompactionEngine 设计

## 概述

Vico 在 `@vico/core` 新增上下文压缩机制：当历史消息过大时，对已完成轮次（turn）的用户/助手/工具消息做增量滚动摘要，生成一条新的持久化摘要消息，后续加载模型上下文不再读取被归档的旧消息。前端聊天记录全量展示不受影响（归档仅作用于模型上下文）。

压缩器分层：`ContextCompactor`（端口 interface）+ `ModelContextCompactor`（默认实现）。触发策略全面对齐 deepseek 的比例阈值（`thresholdRatio=0.8`）+ 双 trigger。

## 压缩触发点

1. **pressure（turn 边界）**：`LoopAgent.start()` 在创建新 turn、注入历史之前调用 `compactForPressure` → `compactor.compactIfNeeded(thread, modelClient, 'pressure', signal)`。仅当 `measure(候选) >= thresholdTokens` 才真正压缩；`contextWindow` 未配置时抛 `TargetPressureConfigError`，由 `compactForPressure` 捕获并告警跳过，不阻塞 turn。
2. **context-overflow（模型报错重试）**：`LoopAgent.callModel()` 首次调用返回 `error` 且 `isContextOverflowError(error)` 命中时，以 `retainTokens=0` 强制压缩（bypass 阈值），随后 `refreshHistory` 用新历史原地替换内存历史前缀（`splice`），再重试一次；受 `maxOverflowRetries` 限次，`noteModelSuccess` 在正常响应时清零计数。
3. **主动压缩**：`Agent.compactThread(threadId, signal?)` → `compactor.compactNow`（忽略阈值），经 `POST /api/v1/threads/:id/compact` 暴露；`busy` 冲突返回 409。

## 摘要消息哨兵约定

- 摘要消息 `role='summary'`、`turnId=thread.id`（哨兵：摘要不属于任何 turn）。
- `metadata.kind='compaction-summary'`、`metadata.previousSummaryId`（增量滚动的上一版摘要 id）。
- 内容为 `CHECKPOINT_PREAMBLE + <compacted-summary> 8 节 checkpoint 模板 </compacted-summary>` 的 framed 文本，`content` 以 JSON 序列化落库。
- `ConversationHistoryMemory.get()` 读取最新非归档摘要，转 `role='system'` 前置，再接最近 N 个 `completed` turn 的非归档消息。

## 先写后删崩溃安全

压缩落库是 **append-only 两段式**：先 `appendEntries` 写入新摘要，再 `archiveMessages` 归档旧摘要 + 被压缩的 head 消息。若在两步之间崩溃，最坏情况是旧消息尚未归档（多出一份冗余摘要/消息），绝不会丢失上下文。`Message.archived` 为 soft delete（`includeArchived:false` 时查询过滤，UI 仍全量展示）。

## 摘要失败 no-op

摘要 LLM 失败/abort、输出为空、shrink check 不通过（framed 摘要不小于被压缩内容）三类失败均 **no-op**：不写摘要、不归档（spec §10），主流程不阻塞，下次 turn 再试——绝不写「原文截断摘要」落库（那会永久丢失被归档细节）。shrink check 基线 = 被归档口径（旧摘要 + head），与 `selectCompactableRange` 的 `removedTokens` 一致。

## 与 deepseek 的差异

| 维度 | deepseek-harness | Vico |
|------|------------------|------|
| contextWindow | provider v4 暴露 | **显式配置**：`ModelConfig.contextWindow` / `server.config.yaml` 的 `model.context_window`（provider v4 不暴露，压缩判定需声明） |
| 超限检测 | 错误码精确匹配 | **启发式**：`isContextOverflowError` 正则匹配 context length / token limit 等 |
| 压缩粒度 | 消息区间 | **turn 级切分**：只压缩 `status='completed'` 的 turn，`selectCompactableRange` 按 turn token 从尾部保留 `retainTokens` |
| 摘要模型 | 独立 | 复用 agent 当前模型（可经 `summarization_provider/model` 切独立摘要模型） |

## 关键文件索引

- `packages/compaction/src/types.ts` — 端口与类型（ContextCompactor / CompactionResult / 触发类型 / 选项）
- `packages/compaction/src/errors.ts` — 压缩错误与 `isContextOverflowError` 超限检测
- `packages/compaction/src/prompts.ts` — 摘要提示词与 framing 常量
- `packages/compaction/src/model-context-compactor.ts` — 默认实现（compactLocked 主流程）
- `packages/core/src/agent/compaction-config.ts` — 配置解析 / 阈值计算 / 可压缩区间选择
- `packages/core/src/agent/token-estimator.ts` — 分 part token 估算 + usage 锚定
- `packages/core/src/agent/loop-agent.ts` — 双 trigger 接线 + `compactThread` + 历史重建
- `packages/core/src/memory/conversation-history-memory.ts` — 摘要前置 + completed/归档过滤
- `packages/core/src/thread/thread-store.ts` — `Message.archived` / `archiveMessages` 端口
- `packages/libsql-adapter` / `packages/mysql-adapter` — `vico_messages.archived` 列与 SQL 适配
- `vico/server/src/agent/get-agent.ts` / `vico/server/src/api/threads.ts` — 配置装配与 HTTP API

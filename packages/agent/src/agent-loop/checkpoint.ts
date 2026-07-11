// @vico/agent - Checkpoint 类型 + CheckpointStore 接口 + 版本迁移
import type { ToolCall, ToolResult } from '../tool/types.js';

/** Checkpoint schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 1;

/** turn 暂停原因及恢复所需信息（从 agent-loop-options.ts 迁移） */
export interface PauseInfo {
  reason: 'tool-approval' | 'error';
  pendingToolCalls: ToolCall[];
  autoApprovedCalls?: ToolCall[];
  autoDeniedResults?: ToolResult[];
  pausedAtStep: number;
  messageCount: number;
}

/** 单个 checkpoint 的完整数据结构 */
export interface Checkpoint {
  id: string;
  turnId: string;
  threadId: string;
  version: number;

  stepIndex: number;
  toolApprovalState: Record<string, boolean>;
  pauseInfo: PauseInfo | null;

  messageCount: number;
  lastMessageId: string | null;

  completedToolCallIds: string[];
  completedToolResults: ToolResult[];
  pendingToolCall: ToolCall | null;

  createdAt: number;
  updatedAt: number;
}

/** CheckpointStore 接口 */
export interface CheckpointStore {
  save(turnId: string, threadId: string, patch: Partial<Checkpoint>): Promise<Checkpoint>;
  getByTurn(turnId: string): Promise<Checkpoint | undefined>;
  listByThread(threadId: string): Promise<Checkpoint[]>;
  deleteByTurn(turnId: string): Promise<void>;
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/**
 * 版本迁移函数映射：version N → version N+1。
 * 每个函数只负责一个版本的升级。
 */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {
  // 示例：v1 → v2
  // 1: (s) => ({ ...s, version: 2, executionTimeline: buildTimeline(s) }),
};

/** 默认 checkpoint 存活时间：7 天 */
export const DEFAULT_CHECKPOINT_TTL = 7 * 24 * 60 * 60 * 1000;

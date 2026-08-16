// @vico/core - Checkpoint 类型 + CheckpointStore 接口 + 版本迁移
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {ToolApproval} from './loop-agent-options.js';

/** Checkpoint schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 1;

/** turn 暂停原因及恢复所需信息（从 loop-agent-options.ts 迁移） */
export interface PauseInfo {
  reason: 'tool-approval' | 'error';
  pendingToolCalls: ToolCall[];
  approvedCalls?: ToolCall[];
  deniedResults?: ToolResult[];
  pausedAtStep: number;
}

/**
 * 单个 checkpoint 的完整数据结构。
 * 存储层采用"关键列 + JSON 快照"混合模式：turnId/threadId/paused/createdAt 作为索引列支持高效查询，
 * 其余复杂嵌套字段序列化到 snapshot JSON 中，方便 Schema 演进和懒迁移。
 */
export interface Checkpoint {
  /** 主键 */
  id: string;
  /** 关联的 turn，getByTurn 点查键，DB 层有唯一约束 */
  turnId: string;
  /** 关联的 thread，listByThread 批量查询键 */
  threadId: string;
  /** Schema 版本号，用于懒迁移（checkpointMigrations） */
  version: number;

  /** 当前执行到的 step 索引，崩溃恢复时从此步继续 loop */
  stepIndex: number;
  /**
   * 本 turn 中已审批通过的工具名 → ToolApproval。
   * 同一 turn 内后续 step 遇到同名工具调用时自动放行，无需重复审批。
   */
  approvedTools: Record<string, ToolApproval>;
  /** 非空表示 turn 被暂停（等待审批或出错），包含暂停原因和待审批的工具调用 */
  pauseInfo: PauseInfo | null;

  /** 已完成工具调用的结果，恢复时直接追加到上下文消息中 */
  completedToolResults: ToolResult[];
  /** 正在执行中尚未持久化的工具调用，恢复时走 retry 路径重新执行 */
  pendingToolCall: ToolCall | null;

  /** 创建时间（Unix ms），purgeExpired 按此字段清理 */
  createdAt: number;
  /** 更新时间（Unix ms） */
  updatedAt: number;
}

/** CheckpointStore 接口 */
export interface CheckpointStore {
  /** 创建新 checkpoint（turn 开始时调用，返回内存对象） */
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  /** 持久化 checkpoint 对象（全量覆盖，内部统一维护 version/updatedAt，不读库） */
  update(checkpoint: Checkpoint): Promise<void>;
  getByTurn(turnId: string): Promise<Checkpoint | undefined>;
  listByThread(threadId: string): Promise<Checkpoint[]>;
  deleteByTurn(turnId: string): Promise<void>;
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/**
 * 构造一个默认的 Checkpoint 对象（turn 开始时由 store 的 create 调用）。
 *
 * @param turnId - 所属 turn
 * @param threadId - 所属 thread
 * @returns 含默认值的完整 Checkpoint
 */
export function createCheckpoint(turnId: string, threadId: string): Checkpoint {
  const now = Date.now();
  return {
    id: `ckpt-${turnId}`,
    turnId,
    threadId,
    version: CHECKPOINT_CURRENT_VERSION,
    stepIndex: 0,
    approvedTools: {},
    pauseInfo: null,
    completedToolResults: [],
    pendingToolCall: null,
    createdAt: now,
    updatedAt: now,
  };
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

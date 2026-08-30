// @vico/core - Checkpoint 多版本类型 + CheckpointStore 接口 + 版本迁移
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {ToolApproval} from './loop-agent-options.js';

/** Checkpoint 快照（snapshot JSON）schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 1;

/** turn 暂停原因及恢复所需信息 */
export interface PauseInfo {
  reason: 'tool-approval' | 'error';
  pendingToolCalls: ToolCall[];
  approvedCalls?: ToolCall[];
  deniedResults?: ToolResult[];
  pausedAtStep: number;
}

/** 下一步意图：模型调用 / 等待审批 / 已结束 */
export type NextAction = 'model' | 'tool-approval' | 'end';

/**
 * vico_checkpoints 一行 = 一个版本（完整快照）。
 * version 为 per-turn 递增链版本号；schemaVersion 为快照 JSON 的 schema 版本（懒迁移用）。
 */
export interface Checkpoint {
  turnId: string;
  threadId: string;
  /** per-turn 递增链版本号 */
  version: number;
  /** 恢复续跑点：下一步从该 step 继续（平铺列 step_index） */
  stepIndex: number;
  /** 下一步意图：模型调用 / 等待审批 / 已结束（平铺列 next_action） */
  nextAction: NextAction;
  /** 本 turn 已批准的工具名 → ToolApproval */
  approvedTools: Record<string, ToolApproval>;
  /** 暂停现场（非空 = 等待审批/出错） */
  pauseInfo: PauseInfo | null;
  /** append 时的最后一条消息 id，fork 时截断消息链用 */
  lastMessageId: string | null;
  /** checkpoint 快照 schema 版本，懒迁移用 */
  schemaVersion: number;
  /** 创建时间（Unix ms），purgeExpired 按整链 created_at 清理 */
  createdAt: number;
}

/**
 * append 追加一个版本的增量 patch。
 * 五个字段全部必填 —— 合并语义为「patch 字段全量覆盖最新版本快照」，消除继承歧义。
 */
export interface CheckpointAppendPatch {
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  pauseInfo: PauseInfo | null;
  lastMessageId: string | null;
}

/** CheckpointStore 接口（append-only 版本链） */
export interface CheckpointStore {
  /** 创建初始版本（version=1、stepIndex=0、nextAction=model），turn 开始时调用 */
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  /** 追加一个版本，版本号 = 当前最大版本 + 1；nextAction 由调用点传入 */
  append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint>;
  /** 读最新版本（版本号最大），崩溃/审批恢复用 */
  getLatest(turnId: string): Promise<Checkpoint | undefined>;
  /** 读指定版本，审计 / fork 用 */
  getVersion(turnId: string, version: number): Promise<Checkpoint | undefined>;
  /** 按版本号升序返回，审计时间线 */
  listVersions(turnId: string): Promise<Checkpoint[]>;
  /** 从历史版本复制快照到新 turn 的初始版本，作为分叉起点；源版本不存在返回 undefined */
  fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined>;
  /** 删除整个 turn 的版本链（显式清理，非自动） */
  deleteByTurn(turnId: string): Promise<void>;
  /** 按整链 created_at 清理：一个 turn 的所有版本一起删（避免断链）；返回被删 turnId 数组 */
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/**
 * 构造初始版本快照（turn 开始时由 store 的 create 调用）。
 *
 * @param turnId - 所属 turn
 * @param threadId - 所属 thread
 * @returns 含默认值的初始 Checkpoint（version=1）
 */
export function createCheckpoint(turnId: string, threadId: string): Checkpoint {
  return {
    turnId,
    threadId,
    version: 1,
    stepIndex: 0,
    nextAction: 'model',
    approvedTools: {},
    pauseInfo: null,
    lastMessageId: null,
    schemaVersion: CHECKPOINT_CURRENT_VERSION,
    createdAt: Date.now(),
  };
}

/**
 * 版本迁移函数映射：schemaVersion N → N+1。
 * 每个函数只负责一个版本的升级。
 */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {
  // 示例：v1 → v2
  // 1: (s) => ({ ...s, schemaVersion: 2, executionTimeline: buildTimeline(s) }),
};

/** 默认 checkpoint 存活时间：30 天 */
export const DEFAULT_CHECKPOINT_TTL = 30 * 24 * 60 * 60 * 1000;

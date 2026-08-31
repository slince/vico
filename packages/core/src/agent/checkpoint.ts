// @vico/core - Checkpoint 版本树类型 + CheckpointStore 接口 + 版本迁移
import type {ToolCall, ToolResult} from '../tool/types.js';
import type {ToolApproval} from './loop-agent-options.js';
import {randomUUID} from 'node:crypto';

/** checkpoint 快照（snapshot JSON）schema 当前版本 */
export const CHECKPOINT_CURRENT_VERSION = 2;

/** 下一步意图：模型调用 / 等待审批 / 已结束（原 PauseInfo.reason 并入） */
export type NextAction = 'model' | 'tool-approval' | 'end';

/**
 * vico_checkpoints 一行 = 一个版本（完整快照）。
 * id 为全局唯一版本节点 id；parentId 指向上一版本（可跨 turn，fork 时指向源版本）。
 * version 为 turn 内单调递增序号（append max+1），仅作顺序/审计标签；血缘由 parentId 表达。
 */
export interface Checkpoint {
  id: string;
  parentId: string | null;
  turnId: string;
  threadId: string;
  version: number;
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  // —— 原 PauseInfo 平铺（恒为数组）——
  pendingApprovalCalls: ToolCall[];
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  lastMessageId: string | null;
  schemaVersion: number;
  createdAt: number;
}

/**
 * append 追加一个版本的增量 patch。全部必填 —— 合并语义为「patch 字段全量覆盖最新版本快照」。
 * parentId 显式传入（= 当前 context.checkpoint.id），支持从非最新叶续跑时正确挂接父版本。
 */
export interface CheckpointAppendPatch {
  parentId: string | null;
  stepIndex: number;
  nextAction: NextAction;
  approvedTools: Record<string, ToolApproval>;
  pendingApprovalCalls: ToolCall[];
  approvedCalls: ToolCall[];
  deniedResults: ToolResult[];
  lastMessageId: string | null;
}

/** CheckpointStore 接口（append-only 版本树） */
export interface CheckpointStore {
  /** 创建初始版本（id=uuid、parentId=null、version=1、stepIndex=0、nextAction=model），turn 开始时调用 */
  create(turnId: string, threadId: string): Promise<Checkpoint>;
  /** 追加一个版本：version = 该 turn 最大版本 + 1，生成新 uuid id，parentId 由 patch 显式指定 */
  append(turnId: string, patch: CheckpointAppendPatch): Promise<Checkpoint>;
  /** 读最新版本（version 最大） */
  getLatest(turnId: string): Promise<Checkpoint | undefined>;
  /** 读指定版本 */
  getVersion(turnId: string, version: number): Promise<Checkpoint | undefined>;
  /** 按 id 读版本（父引用解析、指定叶恢复） */
  getById(id: string): Promise<Checkpoint | undefined>;
  /** 按 version 升序返回，审计时间线 */
  listVersions(turnId: string): Promise<Checkpoint[]>;
  /** 从源版本复制快照到新 turn 初始版本，parentId = 源版本 id（跨 turn 边）；源不存在返回 undefined */
  fork(sourceTurnId: string, version: number, newTurnId: string, newThreadId: string): Promise<Checkpoint | undefined>;
  /** 删除整个 turn 的版本树 */
  deleteByTurn(turnId: string): Promise<void>;
  /** 按整链 created_at 清理；返回被删 turnId 数组 */
  purgeExpired(ttlMs: number): Promise<string[]>;
}

/** 构造初始版本快照（id=uuid、parentId=null、version=1、平铺字段空数组） */
export function createCheckpoint(turnId: string, threadId: string): Checkpoint {
  return {
    id: randomUUID(),
    parentId: null,
    turnId,
    threadId,
    version: 1,
    stepIndex: 0,
    nextAction: 'model',
    approvedTools: {},
    pendingApprovalCalls: [],
    approvedCalls: [],
    deniedResults: [],
    lastMessageId: null,
    schemaVersion: CHECKPOINT_CURRENT_VERSION,
    createdAt: Date.now(),
  };
}

/** 版本迁移函数映射：schemaVersion N → N+1（DROP 重建后无存量 v1，链保持空） */
export const checkpointMigrations: Record<number, (snapshot: Record<string, unknown>) => Record<string, unknown>> = {};

/** 默认 checkpoint 存活时间：30 天 */
export const DEFAULT_CHECKPOINT_TTL = 30 * 24 * 60 * 60 * 1000;

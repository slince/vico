// @vico/core - Thread module type definitions
import type {ModelMessage} from 'ai';
import type {UsageMetrics} from '../shared.js';

/** Session 级工具审批记录 */
export interface SessionApprovedTool {
  /** 批准时间戳 */
  approvedAt: number;
}

/** 线程自定义元数据，包含已知字段并支持任意扩展 */
export interface ThreadMetadata {
  workspace?: string;
  /** Session 级已审批工具映射，跨 turn 生效 */
  sessionApprovedTools?: Record<string, SessionApprovedTool>;
  /** 线程累计 token 用量（所有已完结 turn 的 usage 之和，含分叉调用） */
  usage?: UsageMetrics;
  [key: string]: unknown;
}

/** 轮次自定义元数据，包含已知字段并支持任意扩展 */
export interface TurnMetadata {
  workspace?: string;
  /** 本 turn 累计 token 用量（跨 step 累加；暂停时写快照，恢复后继续累加） */
  usage?: UsageMetrics;
  [key: string]: unknown;
}

/** 线程上下文参数，可携带 userId/scopeId/workspace 及任意自定义字段 */
export interface ThreadContext {
  userId?: string;
  metadata?: ThreadMetadata;
}

/** 会话线程 */
export interface Thread {
  id: string;
  agentId: string;
  userId?: string;
  title?: string;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: ThreadMetadata;
  /** 是否已归档（软归档，数据保留但默认不出现在会话列表） */
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}


export type TurnStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'paused'

/** 单次对话轮次 */
export interface Turn {
  id: string;
  threadId: string;
  status: TurnStatus;
  steps: number;
  /** 自定义元数据（JSON 可序列化），如 PauseInfo */
  metadata?: TurnMetadata;
  /** 本 turn 由源 turn 的某版本分叉而来（null = 普通 turn） */
  forkedFrom?: { turnId: string; version: number } | null;
  createdAt: number;
}


export type MessageMetadata = Record<string, unknown>

/** 对话记录条目 — content 存原生 ModelMessage.content 的 JSON 序列化（string 或 parts 数组） */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  /** JSON.stringify(ModelMessage.content)，读取时 JSON.parse 还原 */
  content: string;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: MessageMetadata;
  /** 是否已被压缩归档（模型上下文不再读取；UI 仍全量展示） */
  archived?: boolean;
  createdAt: number;
}

/** 会话持久化端口 */
export interface ThreadStore {
  /** Thread 操作 */

  /** 创建新线程 */
  createThread(agentId: string, title: string, id: string, opts?: ThreadContext): Promise<Thread>;
  /** 获取线程详情 */
  getThread(threadId: string): Promise<Thread | undefined>;
  /** 列出线程（可按 agentId / userId 筛选） */
  listThreads(filter?: { agentId?: string; userId?: string }): Promise<Thread[]>;
  /** 更新线程信息（title、metadata、archived 等） */
  updateThread(threadId: string, patch: Partial<Pick<Thread, 'title' | 'metadata' | 'archived'>>): Promise<void>;
  /** 删除线程及其全部轮次与消息（不存在时静默忽略） */
  deleteThread(threadId: string): Promise<void>;

  /** Turn 操作 */

  /** 创建新轮次，可携带 fork 来源（forkedFrom） */
  createTurn(threadId: string, opts?: { forkedFrom?: Turn['forkedFrom'] }): Promise<Turn>;
  /** 更新轮次状态 */
  updateTurn(turnId: string, patch: Partial<Turn>): Promise<void>;
  /** 获取轮次详情 */
  getTurn(turnId: string): Promise<Turn | undefined>;

  /** 消息操作 */

  /** 批量追加对话记录 */
  appendEntries(entries: Omit<Message, 'id' | 'createdAt'>[]): Promise<Message[]>;
  /** 获取线程的对话记录列表（支持分页、角色筛选、归档过滤） */
  getEntries(threadId: string, options?: { limit?: number; start?: number; roles?: string[]; includeArchived?: boolean }): Promise<Message[]>;
  /** 批量获取多个 turn 的对话记录（可选排除已归档） */
  getEntriesByTurns(turnIds: string[], options?: { includeArchived?: boolean }): Promise<Message[]>;
  /** 批量归档消息（软标记 archived=true），只作用于已完成 turn 的消息 */
  archiveMessages(threadId: string, messageIds: string[]): Promise<void>;
  /** 获取线程中最近的一个 turn（用于检测是否有暂停的 turn） */
  getLatestTurn(threadId: string): Promise<Turn | undefined>;
  /** 获取线程最近 limit 个轮次（按创建时间倒序），可选按状态过滤 */
  getRecentTurns(threadId: string, limit: number, status?: Turn['status']): Promise<Turn[]>;
}

/** 一次 turn 的会话标识，贯穿 model 调用和工具执行 */
export interface TurnSession {
  workspace?: string;
  thread: Thread;
  turn: Turn;
}

/**
 * Step — turn 内的一次 LLM 调用 + 可选工具执行。
 * 由 _run 在每轮迭代时创建，随 callModel / executeToolCalls / dispatchTools 流转。
 */
export interface TurnStep {
  /** 当前步骤编号（0 起始） */
  index: number;

  /** 本轮step的会话*/
  messages: ModelMessage[];
}

// @vico/agent - Thread module type definitions
import type { ModelMessage } from '../model/types.js';

/** 会话线程 */
export interface Thread {
  id: string;
  agentId: string;
  userId?: string;
  title?: string;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** 单次对话轮次 */
export interface Turn {
  id: string;
  threadId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted' | 'paused';
  steps: number;
  /** 自定义元数据（JSON 可序列化），如 PauseInfo */
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** 对话记录条目 */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/** 会话持久化端口 */
export interface ThreadStore {
  /** Thread 操作 */

  /** 创建新线程 */
  createThread(agentId: string, title: string, id: string, opts?: { userId?: string; metadata?: Record<string, unknown> }): Promise<Thread>;
  /** 获取线程详情 */
  getThread(threadId: string): Promise<Thread | undefined>;
  /** 列出线程（可按 agentId / userId 筛选） */
  listThreads(filter?: { agentId?: string; userId?: string }): Promise<Thread[]>;

  /** Turn 操作 */

  /** 创建新轮次 */
  createTurn(threadId: string): Promise<Turn>;
  /** 更新轮次状态 */
  updateTurn(turnId: string, patch: Partial<Turn>): Promise<void>;
  /** 获取轮次详情 */
  getTurn(turnId: string): Promise<Turn | undefined>;

  /** 消息操作 */

  /** 追加对话记录 */
  appendEntry(entry: Omit<Message, 'id' | 'createdAt'>): Promise<Message>;
  /** 获取线程的对话记录列表（支持分页） */
  getEntries(threadId: string, options?: { limit?: number; start?: number }): Promise<Message[]>;
  /** 获取线程最近 limit 条对话记录 */
  getRecentEntries(threadId: string, limit: number): Promise<Message[]>;
  /** 获取指定 turn 的对话记录 */
  getEntriesByTurn(turnId: string, options?: { limit?: number; start?: number }): Promise<Message[]>;
  /** 获取线程中最近的一个 turn（用于检测是否有暂停的 turn） */
  getLatestTurn(threadId: string): Promise<Turn | undefined>;
}

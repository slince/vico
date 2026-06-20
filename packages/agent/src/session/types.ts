// @vico/agent - Session module type definitions
import type { ModelMessage } from '../model/types.js';

/** 会话线程 */
export interface Thread {
  id: string;
  agentId: string;
  tenantId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
}

/** 单次对话轮次 */
export interface Turn {
  id: string;
  threadId: string;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  steps: number;
  createdAt: number;
}

/** 对话记录条目 */
export interface ConversationEntry {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  content: string;
  toolCalls?: unknown;
  toolResults?: unknown;
  createdAt: number;
}

/** 会话持久化端口 */
export interface SessionStore {
  /** Thread 操作 */

  /** 创建新线程 */
  createThread(agentId: string, tenantId: string, title?: string): Promise<Thread>;
  /** 获取线程详情 */
  getThread(threadId: string): Promise<Thread | undefined>;
  /** 列出租户下所有线程 */
  listThreads(tenantId: string, agentId?: string): Promise<Thread[]>;

  /** Turn 操作 */

  /** 创建新轮次 */
  createTurn(threadId: string): Promise<Turn>;
  /** 更新轮次状态 */
  updateTurn(turnId: string, patch: Partial<Turn>): Promise<void>;
  /** 获取轮次详情 */
  getTurn(turnId: string): Promise<Turn | undefined>;

  /** 消息操作 */

  /** 追加对话记录 */
  appendEntry(entry: Omit<ConversationEntry, 'id' | 'createdAt'>): Promise<ConversationEntry>;
  /** 获取线程的对话记录列表 */
  getEntries(threadId: string, limit?: number): Promise<ConversationEntry[]>;
}

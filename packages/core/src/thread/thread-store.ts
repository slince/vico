// @vico/core - Thread module type definitions

/** 线程自定义元数据，包含已知字段并支持任意扩展 */
export interface ThreadMetadata {
  workspace?: string;
  [key: string]: unknown;
}

/** 轮次自定义元数据，包含已知字段并支持任意扩展 */
export interface TurnMetadata {
  workspace?: string;
  [key: string]: unknown;
}

/** 线程上下文参数，可携带 userId/scopeId/workspace 及任意自定义字段 */
export interface ThreadContext {
  userId?: string;
  scopeId?: string;
  workspace?: string;
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
  createdAt: number;
}

/** 对话记录条目 — content 存原生 ModelMessage.content 的 JSON 序列化（string 或 parts 数组） */
export interface Message {
  id: string;
  threadId: string;
  turnId: string;
  role: string;
  /** JSON.stringify(ModelMessage.content)，读取时 JSON.parse 还原 */
  content: string;
  /** 自定义上下文字段（JSON 可序列化） */
  metadata?: Record<string, unknown>;
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
  /** 更新线程信息（title、metadata 等） */
  updateThread(threadId: string, patch: Partial<Pick<Thread, 'title' | 'metadata'>>): Promise<void>;

  /** Turn 操作 */

  /** 创建新轮次 */
  createTurn(threadId: string): Promise<Turn>;
  /** 更新轮次状态 */
  updateTurn(turnId: string, patch: Partial<Turn>): Promise<void>;
  /** 获取轮次详情 */
  getTurn(turnId: string): Promise<Turn | undefined>;

  /** 消息操作 */

  /** 批量追加对话记录 */
  appendEntries(entries: Omit<Message, 'id' | 'createdAt'>[]): Promise<Message[]>;
  /** 获取线程的对话记录列表（支持分页和角色筛选） */
  getEntries(threadId: string, options?: { limit?: number; start?: number; roles?: string[] }): Promise<Message[]>;
  /** 批量获取多个 turn 的对话记录 */
  getEntriesByTurns(turnIds: string[]): Promise<Message[]>;
  /** 获取线程中最近的一个 turn（用于检测是否有暂停的 turn） */
  getLatestTurn(threadId: string): Promise<Turn | undefined>;
  /** 获取线程最近 limit 个轮次（按创建时间倒序），可选按状态过滤 */
  getRecentTurns(threadId: string, limit: number, status?: Turn['status']): Promise<Turn[]>;
}

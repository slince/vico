/**
 * Agent 配置 — 从数据库加载的完整 Agent 定义。
 * 这是框架层看到的 Agent，与 DB schema 解耦。
 */
export interface AgentConfig {
  /** 全局唯一标识 */
  id: string;
  /** 所属租户 */
  tenantId: string;
  /** 显示名称 */
  name: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 模型标识（由 ModelClient 解析，如 "openai/gpt-4o"） */
  modelId: string;
  /** Temperature (0-2) */
  temperature?: number;
  /** 最大输出 Token */
  maxTokens?: number;
  /** 推理力度 */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** 已绑定的 Skill ID 列表 */
  skillIds: string[];
  /** 已绑定的知识库 ID */
  knowledgeBaseIds: string[];
  /** RAG 模式 */
  ragMode: 'disabled' | 'auto' | 'always';
  /** 每 Turn 最大模型步数 */
  maxSteps?: number;
  /** 额外元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Agent 运行时上下文 — 在每次 Turn 执行时注入的动态数据。
 */
export interface AgentContext {
  tenantId: string;
  userId: string;
  agentId: string;
  threadId: string;
  /** 对话历史（最近 N 条消息） */
  history: Message[];
  /** 短期记忆窗口大小 */
  stmWindow: number;
  /** 用户当前消息 */
  userMessage: string;
  /** 工作目录路径（可选，影响工具执行） */
  workspace?: string;
}

/**
 * 通用消息类型 — 框架内部统一的消息表示。
 */
export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCallMessage[];
  createdAt: number;
}

export interface ToolCallMessage {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

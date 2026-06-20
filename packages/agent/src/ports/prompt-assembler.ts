import type { AgentConfig, Message } from './agent.js';
import type { ModelRequest, ModelMessage, ToolSpec } from './model-client.js';
import type { Skill } from './skill-loader.js';
import type { MemoryRecord, RagChunk } from './memory-store.js';

/**
 * Prompt 拼装上下文 — 包含组装系统提示词所需的所有数据。
 */
export interface PromptContext {
  /** Agent 配置 */
  agent: AgentConfig;
  /** 可用 Skill 列表（元数据，非完整指令） */
  skillCatalog: Skill[];
  /** 检索到的长期记忆 */
  memoryItems: MemoryRecord[];
  /** RAG 检索结果 */
  ragResults: RagChunk[];
  /** 短期记忆（对话历史） */
  stmMessages: Message[];
  /** 可用工具定义列表 */
  tools: ToolSpec[];
  /** 动态指令（由 AgentLoop 注入，如 Goal/Todo 指令等） */
  dynamicInstructions?: string[];
}

/**
 * PromptAssembler — 系统提示词拼装端口。
 * 负责将 Agent 配置、Skill、Memory、RAG 等组装为发送给 LLM 的完整请求。
 */
export interface PromptAssembler {
  assemble(context: PromptContext): ModelRequest;
}

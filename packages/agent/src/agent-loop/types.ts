// @vico/agent - AgentLoop module type definitions
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { PromptAssembler } from '../prompt/assembler.js';
import type { PromptContext, SkillCatalogEntry, RagChunk } from '../prompt/types.js';
import type { ToolHost, ToolExecutionContext } from '../tool/types.js';
import type { ToolCall, ToolResult, ToolSpec } from '../contracts/tool.js';
import type { EventRecorder } from '../observable/types.js';
import type { SpanTracker } from '../observable/types.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import type { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';
import type { AgentConfig } from '../contracts/agent.js';
import type { MemoryStore } from '../memory/types.js';

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  config: AgentConfig;
  model: ModelClient;
  toolHost: ToolHost;
  promptAssembler: PromptAssembler;
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  approvalGate?: ApprovalGate;
  hooks?: CompositeHookRunner;
  events: EventRecorder;
  spanTracker: SpanTracker;

  /** 预计算的 Skill 目录（注入 PromptContext） */
  skillCatalog?: SkillCatalogEntry[];
  /** 长期记忆提供器（每 turn 前检索） */
  memoryProvider?: MemoryStore;
  /** RAG 知识库检索 */
  ragProvider?: { search(query: string, kbId: string, limit?: number): Promise<RagChunk[]> };
  /** 绑定的工具列表（注入 LLM 请求） */
  boundTools?: ToolSpec[];
}

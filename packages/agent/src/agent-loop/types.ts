// @vico/agent - AgentLoop module type definitions
import { z } from 'zod';
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { ContextProcessor } from '../prompt/context-processor.js';
import type { ToolExecutionContext } from '../tool/types.js';
import type { ToolBroker } from '../tool/tool-broker.js';
import type { Tool, ToolCall, ToolResult } from '../tool/types.js';
import type { EventRecorder } from '../observable/types.js';
import type { SpanTracker } from '../observable/types.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import type { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';
import type { AgentLoop } from './agent-loop.js';
import type { Skill } from '../skill/types.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { WorkingMemory } from '../memory/types.js';

/** 模型引用 */
export const ModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
});

/** Agent 配置（从 DB 加载） */
export const AgentConfigSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(128),
  systemPrompt: z.string().default(''),
  model: ModelRefSchema,
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().positive().default(4096),
  maxSteps: z.number().int().min(1).max(100).default(10),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema> & {
  /** 工具存储 — 加载该 Agent 绑定的工具 */
  tools?: import('../tool/types.js').ToolStore;
  /** Skill 存储 — 加载该 Agent 绑定的 Skill */
  skills?: import('../skill/types.js').SkillStore;
};
export type ModelRef = z.infer<typeof ModelRefSchema>;

/** 一次 turn 的执行结果 */
export interface TurnResult {
  status: 'completed' | 'failed' | 'aborted' | 'interrupted';
  steps: number;
  usage: { input: number; output: number };
  messages: ModelMessage[];
}

/** runTurn 选项 */
export interface RunTurnOptions {
  scopeId?: string;
  userId?: string;
  workspace?: string;
}

/** turn 执行过程中的流式事件 */
export type TurnEvent =
  | { type: 'text_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_result'; id: string; name: string; status: 'success' | 'error'; output: unknown }
  | { type: 'step_start'; step: number }
  | { type: 'step_end'; step: number }
  | { type: 'compacted'; removedTokens: number }
  | { type: 'error'; message: string }
  | { type: 'done'; usage: { input: number; output: number } };

/** AgentLoop 构造选项 */
export interface AgentLoopOptions {
  agent: Agent;
  model: ModelClient;
  toolBroker: ToolBroker;
  /** 上下文处理器列表 — 在 model 调用前按优先级依次执行。缺少时回退到无增强的裸模式 */
  processors?: ContextProcessor[];
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  approvalGate?: ApprovalGate;
  hooks?: CompositeHookRunner;
  events: EventRecorder;
  spanTracker: SpanTracker;
  /** 工作记忆（提供时自动注册 updateWorkingMemory 工具 handler） */
  workingMemory?: WorkingMemory;
}

/** Agent — 配置 + 运行时 loop（延迟构建）+ 绑定（memory/skills/tools） */
export class Agent {
  readonly config: AgentConfig;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory?: MemoryStore;

  private _loop?: AgentLoop;
  private loopFactory: () => AgentLoop;

  constructor(params: {
    config: AgentConfig;
    loopFactory: () => AgentLoop;
    skills?: Skill[];
    tools?: Tool[];
    memory?: MemoryStore;
  }) {
    this.config = params.config;
    this.loopFactory = params.loopFactory;
    this.skills = params.skills ?? [];
    this.tools = params.tools ?? [];
    this.memory = params.memory;
  }

  /** 获取 AgentLoop（首次调用时构建并缓存） */
  getLoop(): AgentLoop {
    if (!this._loop) {
      this._loop = this.loopFactory();
    }
    return this._loop;
  }
}

/** Agent 工厂函数 — 由外部注入，负责按配置组装 Agent */
export type AgentFactory = (config: AgentConfig) => Promise<Agent>;

// @vico/agent - AgentLoop module type definitions
import type { ModelClient, ModelMessage } from '../model/types.js';
import type { ContextProcessor } from '../prompt/context-processor.js';
import type { ToolHost, ToolExecutionContext } from '../tool/types.js';
import type { ToolCall, ToolResult, ToolSpec } from '../contracts/tool.js';
import type { EventRecorder } from '../observable/types.js';
import type { SpanTracker } from '../observable/types.js';
import type { CompositeHookRunner } from '../hook/hook-runner.js';
import type { ContextCompactor } from './context-compactor.js';
import type { TokenEconomy } from './token-economy.js';
import type { ApprovalGate } from './approval-gate.js';
import type { AgentConfig } from '../contracts/agent.js';
import type { AgentLoop } from './agent-loop.js';
import type { Skill } from '../skill/types.js';
import type { MemoryStore } from '../memory/memory-store.js';
import type { WorkingMemory } from '../memory/types.js';

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
  /** 上下文处理器列表 — 在 model 调用前按优先级依次执行。缺少时回退到无增强的裸模式 */
  processors?: ContextProcessor[];
  /** 绑定的工具列表（注入 LLM 请求） */
  boundTools?: ToolSpec[];
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
  readonly tools: ToolSpec[];
  readonly memory?: MemoryStore;

  private _loop?: AgentLoop;
  private loopFactory: () => AgentLoop;

  constructor(params: {
    config: AgentConfig;
    loopFactory: () => AgentLoop;
    skills?: Skill[];
    tools?: ToolSpec[];
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

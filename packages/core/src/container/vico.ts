// @vico/core - Vico: one-shot wiring for all Agent services
import type {TurnEvent} from '../agent-loop/types.js';
import type {AgentConfig, LanguageModelFactory} from '../agent-loop/create-agent.js';
import {createAgent} from '../agent-loop/create-agent.js';
import type {Tool} from '../tool/types.js';
import type {Agent} from '../agent-loop/agent.js';
import {AgentRuntime} from '../agent-loop/agent-runtime.js';
import {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/thread-store.js';
import {MittEventRecorder} from '../events/event-recorder.js';
import {TurnTracer} from '../observable/turn-tracer.js';
import {createAdaptersFromLevel} from '../observable/trace-adapter.js';
import type {SkillOptions, TraceOptions} from "./options.js";
import type {CheckpointStore} from "../agent-loop/checkpoint.js";

/** Vico 配置选项 */
export interface VicoOptions {
  /** Skill 配置 */
  skills?: SkillOptions;
  /** 额外的工具 */
  tools?: Tool[];
  /** LanguageModel 工厂（不传则使用内置 createLanguageModel） */
  languageModelFactory?: LanguageModelFactory;
  /** AgentRuntime LRU 缓存上限（默认 50） */
  maxCached?: number;
  /** AgentLoop 追踪：TraceLevel 快捷配置 或 自定义适配器（不传等同 0） */
  trace?: TraceOptions;
  /** 全局 MemoryStore（agent 自身未配置时使用） */
  memory?: MemoryStore;
  /** 全局 ThreadStore（agent 自身未配置时使用） */
  thread?: ThreadStore;
  /** 全局 CheckpointStore（agent 自身未配置时使用） */
  checkpointStore?: CheckpointStore;
}

/**
 * Vico — 一键装配所有 Agent 服务。
 *
 * @example
 * ```ts
 * const vico = new Vico({ skillRoots: ['./skills'] });
 * await vico.init();
 *
 * // 创建 Agent 并注册到 Runtime
 * await vico.createAgent(config);
 *
 * // 一行对话
 * const result = await vico.invoke(config.id, 'Hello');
 * ```
 */
export class Vico {
  readonly events = new MittEventRecorder<TurnEvent>();
  readonly tracer: TurnTracer;

  private options: VicoOptions;
  readonly runtime: AgentRuntime;
  readonly memory?: MemoryStore;
  readonly thread?: ThreadStore;
  readonly checkpointStore?: CheckpointStore;

  constructor(options: VicoOptions = {}) {
    this.options = options;
    this.tracer = this.createTracer(options.trace);
    this.runtime = new AgentRuntime(this.options.maxCached);
    this.memory = options.memory;
    this.thread = options.thread;
    this.checkpointStore = options.checkpointStore;
  }

  /** 根据 TraceOptions 构建 TurnTracer */
  private createTracer(trace?: TraceOptions): TurnTracer {
    const resolved = trace ?? 0;
    const adapters = typeof resolved === 'object'
      ? [...createAdaptersFromLevel(resolved.level ?? 0), ...(resolved.adapters ?? [])]
      : createAdaptersFromLevel(resolved);
    return new TurnTracer(this.events, adapters);
  }

  /**
   * 获取 Agent，若不存在则通过 factory 创建并注册。
   * @param agentId - Agent 唯一标识
   * @param factory - 创建 Agent 配置的工厂函数（仅在 Agent 不存在时调用）
   * @returns 已存在的或新创建的 Agent 实例
   */
  async createIfAbsent(agentId: string, factory: () => Promise<AgentConfig>): Promise<Agent> {
    const existing = this.runtime.getAgent(agentId);
    if (existing) return existing;
    return this.createAgent(await factory());
  }

  /**
   * 构建 Agent 并注册到 Runtime。
   * @param config - Agent 创建配置
   * @returns 已注册的 Agent 实例
   */
  async createAgent(config: AgentConfig): Promise<Agent> {
    const agent = await this.buildAgent(config);
    this.runtime.register(agent);
    return agent;
  }

  /**
   * 创建单个 Agent（无缓存），委托到独立 buildAgent。
   */
  private async buildAgent(config: AgentConfig): Promise<Agent> {
    return createAgent({
      ...config,
      tools: config.tools ?? this.options.tools,
      skills: config.skills ?? this.options.skills,
      memory: config.memory ?? this.memory,
      thread: config.thread ?? this.thread,
      checkpointStore: config.checkpointStore ?? this.checkpointStore,
      tracer: config.tracer ?? this.tracer,
      events: config.events ?? this.events,
    });
  }
}

import type {LanguageModelV3} from '@ai-sdk/provider';
import {ModelClient} from '../model/model-client.js';
import type {TurnEvent, TurnResult, ResumeTurnOptions} from './types.js';
import type {ApprovalResolver, Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/types.js';
import type {EventPayload, EventRecorder} from '../events/types.js';
import type {AgentLoop} from './agent-loop.js';
import {buildLoop} from "./utils.js";
import {TurnOutput} from "./turn-output.js";
import {ModelMessage} from "../model/types.js";
import {TurnTracer} from "../observable/turn-tracer.js";

export type LoopFactory = (agent: Agent) => AgentLoop

/** invoke 调用选项 */
export interface InvokeOptions {
  threadId?: string;
  userId?: string;
  workspace?: string;
  scopeId?: string;
}

/** Agent 构造参数 */
export interface AgentOptions {
  id: string;
  name: string;
  systemPrompt: string;
  model: LanguageModelV3;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
  skills: Skill[];
  tools: Tool[];
  memory: MemoryStore;
  thread: ThreadStore;
  /** 工作空间路径，作为工具执行的默认工作目录 */
  workspace?: string;
  /** 审批决策器，未提供则使用默认策略决策 */
  approvalResolver: ApprovalResolver;
  events: EventRecorder<TurnEvent>;
  tracer: TurnTracer;
  loopFactory?: LoopFactory;
}

/** Agent — 配置 + 运行时 loop + 绑定（memory/thread/skills/tools） */
export class Agent {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: LanguageModelV3;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly maxTokens: number;
  readonly maxSteps: number;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory: MemoryStore;
  readonly thread: ThreadStore;
  readonly approvalResolver: ApprovalResolver;
  readonly events: EventRecorder<TurnEvent>;
  readonly tracer: TurnTracer;
  readonly loop: AgentLoop;
  readonly workspace?: string;

  constructor(params: AgentOptions) {
    this.id = params.id;
    this.name = params.name;
    this.systemPrompt = params.systemPrompt;
    this.model = params.model;
    this.modelClient = new ModelClient(params.model);
    this.temperature = params.temperature;
    this.maxTokens = params.maxTokens;
    this.maxSteps = params.maxSteps;
    this.skills = params.skills;
    this.tools = params.tools;
    this.memory = params.memory;
    this.thread = params.thread;
    this.approvalResolver = params.approvalResolver;
    this.events = params.events;
    this.tracer = params.tracer;
    this.workspace = params.workspace;

    const loopFactory = params.loopFactory || buildLoop;
    this.loop = loopFactory(this)
  }

  /**
   * 订阅 turn 事件，委托给 AgentLoop 的事件系统。
   *
   * @param event - 事件类型名称
   * @param handler - 事件处理函数
   */
  on<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.on(event, handler);
  }

  /**
   * 取消订阅 turn 事件。
   *
   * @param event - 事件类型名称
   * @param handler - 要移除的事件处理函数
   */
  off<K extends string>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void {
    this.events.off(event, handler);
  }

  /**
   * 发起一次对话：发送消息并等待返回最终结果（非流式）。
   *
   * @param message - 用户消息内容
   * @param options - 调用可选参数
   * @param options.threadId - 指定线程 ID（不传则自动生成）
   * @param options.userId - 用户 ID
   * @param options.workspace - 工作空间路径
   * @param options.scopeId - 工作记忆作用域标识
   * @returns turn 最终结果
   */
  async invoke(message: string, options?: InvokeOptions): Promise<TurnResult> {
    const output = this.run(message, options);
    return output.result;
  }

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   *
   * @param message - 用户消息内容
   * @param options - 调用可选参数
   * @param options.threadId - 指定线程 ID（不传则自动生成）
   * @param options.userId - 用户 ID
   * @param options.workspace - 工作空间路径
   * @param options.scopeId - 工作记忆作用域标识
   * @returns TurnOutput 实例，包含输出流和结果 Promise
   */
  stream(message: string, options?: InvokeOptions): TurnOutput {
    return this.run(message, options);
  }

  /**
   * 构造用户消息并启动 AgentLoop runTurn。
   *
   * @param message - 用户消息内容
   * @param options - 调用可选参数
   * @param options.threadId - 指定线程 ID（不传则自动生成）
   * @param options.userId - 用户 ID
   * @param options.workspace - 工作空间路径
   * @param options.scopeId - 工作记忆作用域标识
   * @returns TurnOutput 实例
   */
  /**
   * 恢复一个已暂停的 turn。
   *
   * @param opts - 恢复选项
   * @returns TurnOutput 实例
   */
  resumeTurn(opts: ResumeTurnOptions): TurnOutput {
    return this.loop.resumeTurn(opts);
  }

  private run(message: string, options?: InvokeOptions) {
    const userMessage: ModelMessage = { role: 'user', content: message };
    const threadId = options?.threadId ?? `invoke-${this.id}-${Date.now()}`;
    return this.loop.runTurn(threadId, userMessage, {
      userId: options?.userId,
      workspace: options?.workspace ?? this.workspace,
      scopeId: options?.scopeId,
    });
  }

}

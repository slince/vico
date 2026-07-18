import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ModelMessage} from 'ai';
import {convertToModelMessages, validateUIMessages} from 'ai';
import {ModelClient} from '../model/model-client.js';
import type {ReasoningEffort} from '../model/types.js';
import type {TurnEvent} from './types.js';
import type {ApprovalResolver, Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/thread-store.js';
import type {EventPayload, EventRecorder} from '../events/types.js';
import type {AgentLoop} from './agent-loop.js';
import {buildLoop} from "./utils.js";
import {TurnOutput} from "./turn-output.js";
import {TurnTracer} from "../observable/turn-tracer.js";
import {RunOptions, TurnResult} from "./agent-loop-options.js";
import type {UserMessage} from '../stream/types.js';
import type {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {CheckpointStore} from './checkpoint.js';
import pino, {Logger} from 'pino';

export type LoopFactory = (agent: Agent) => AgentLoop

/** Agent 构造参数 */
export interface AgentOptions {
  id: string;
  name: string;
  systemPrompt: string;
  model: LanguageModelV4;
  temperature: number;
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
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
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  checkpointStore: CheckpointStore;
  logger?: Logger;
}

/** Agent — 配置 + 运行时 loop + 绑定（memory/thread/skills/tools） */
export class Agent<TMetadata extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly model: LanguageModelV4;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly reasoning?: ReasoningEffort;
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
  readonly compactor?: ContextCompactor;
  readonly tokenEconomy?: TokenEconomy;
  readonly checkpointStore: CheckpointStore;
  readonly logger: Logger;

  constructor(params: AgentOptions) {
    this.id = params.id;
    this.name = params.name;
    this.systemPrompt = params.systemPrompt;
    this.model = params.model;
    this.modelClient = new ModelClient(params.model);
    this.temperature = params.temperature;
    this.reasoning = params.reasoning;
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
    this.compactor = params.compactor;
    this.tokenEconomy = params.tokenEconomy;
    this.checkpointStore = params.checkpointStore;
    this.logger = params.logger ?? pino();

    this.loop = buildLoop(this)
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
   * @param message - 用户消息内容，支持纯文本字符串或原生 UIMessage 数组
   * @param options - 调用可选参数
   * @param options.threadId - 指定线程 ID（不传则自动生成）
   * @param options.userId - 用户 ID
   * @param options.workspace - 工作空间路径
   * @param options.scopeId - 工作记忆作用域标识
   * @returns turn 最终结果
   */
  async invoke(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnResult> {
    const output = await this.run(message, options);
    return output.result;
  }

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   * UIMessage[] 入参会先校验并转换为原生 ModelMessage。
   */
  stream(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput> {
    return this.run(message, options);
  }

  /**
   * 构造用户消息并启动 AgentLoop runTurn。
   * string → 单条 user 消息；UIMessage[] → validateUIMessages + convertToModelMessages 后取最后一条。
   */
  private async run(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput> {
    let userMessage: ModelMessage;
    if (typeof message === 'string') {
      userMessage = { role: 'user', content: message };
    } else {
      const validated = await validateUIMessages({ messages: message });
      const converted = await convertToModelMessages(validated, { ignoreIncompleteToolCalls: true });
      // 历史由 Memory 注入，此处只取转换结果的最后一条作为本轮用户消息
      userMessage = converted[converted.length - 1] ?? { role: 'user', content: '' };
    }
    return this.loop.run(userMessage, options);
  }

}

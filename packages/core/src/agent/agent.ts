// @vico/core - Agent 对外契约（interface）与构造参数
import type {LanguageModelV4} from '@ai-sdk/provider';
import type {ToolSet} from 'ai';
import type {ModelClient} from '../model/model-client.js';
import type {ReasoningEffort} from '../model/types.js';
import type {ToolMetadata, TurnEvent} from './types.js';
import type {ApprovalResolver, Tool} from '../tool/types.js';
import type {Skill} from '../skill/types.js';
import type {MemoryStore} from '../memory/memory-store.js';
import type {ThreadStore} from '../thread/thread-store.js';
import type {EventPayload, EventRecorder, EventType} from '../events/types.js';
import type {TurnOutput} from './turn-output.js';
import type {RunOptions, TurnResult} from './loop-agent-options.js';
import type {UserMessage} from '../stream/types.js';
import type {ContextCompactor} from './context-compactor.js';
import type {TokenEconomy} from './token-economy.js';
import type {CheckpointStore} from './checkpoint.js';
import type {Logger} from 'pino';

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
  approvalResolver?: ApprovalResolver;
  events: EventRecorder<TurnEvent>;
  compactor?: ContextCompactor;
  tokenEconomy?: TokenEconomy;
  checkpointStore: CheckpointStore;
  logger?: Logger;
}

/**
 * Agent — 对外契约。
 * 定义配置字段与对话入口（invoke / stream / on / off）。
 * 默认实现为 {@link LoopAgent}。
 */
export interface Agent<TToolSet extends ToolSet = ToolSet, TMetadata extends ToolMetadata = ToolMetadata> {
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
  readonly workspace?: string;
  readonly compactor?: ContextCompactor;
  readonly tokenEconomy?: TokenEconomy;
  readonly checkpointStore: CheckpointStore;
  readonly logger: Logger;

  /**
   * 订阅 turn 事件。
   *
   * @param event - 事件类型名称
   * @param handler - 事件处理函数
   */
  on<K extends EventType<TurnEvent>>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void;

  /**
   * 取消订阅 turn 事件。
   *
   * @param event - 事件类型名称
   * @param handler - 要移除的事件处理函数
   */
  off<K extends EventType<TurnEvent>>(event: K, handler: (data: EventPayload<TurnEvent, K>) => void): void;

  /**
   * 发起一次对话：发送消息并等待返回最终结果（非流式）。
   *
   * @param message - 用户消息
   * @param options - 调用可选参数
   * @returns turn 最终结果
   */
  invoke(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnResult>;

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   *
   * @param message - 用户消息
   * @param options - turn 运行可选参数
   */
  stream(message: UserMessage, options?: RunOptions<TMetadata>): Promise<TurnOutput>;
}

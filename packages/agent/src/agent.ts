// @vico/agent - Agent 对外契约（interface）与构造参数
import type {ModelClient} from '@vico/model';
import type {ModelRef, ReasoningEffort} from '@vico/model';
import type {ApprovalDecider, Tool} from '@vico/tool';
import type {Skill} from '@vico/skill';
import type {MemoryStore} from '@vico/memory';
import type {Thread, ThreadStore} from '@vico/thread';
import type {EventPayload, EventRecorder, EventType} from '@vico/events';
import type {TurnOutput} from './turn-output.js';
import type {RunOptions, TurnResult} from './loop-agent-options.js';
import type {TurnEvent, UserMessage} from '@vico/stream';
import type {ContextCompactor, CompactionResult} from '@vico/compaction';
import type {CheckpointStore} from '@vico/checkpoint';
import type {Logger} from 'pino';

/** Agent 构造参数 */
export interface AgentOptions {
  id: string;
  name: string;
  systemPrompt: string;
  /** 模型引用（LanguageModel 实例或 ModelConfig 配置），内部解析为 LanguageModel */
  model: ModelRef;
  temperature: number;
  /** 推理力度，不传则 provider 默认 */
  reasoning?: ReasoningEffort;
  /** 最大输出 token 数，不传则由 provider 决定 */
  maxTokens?: number;
  maxSteps: number;
  skills: Skill[];
  tools: Tool[];
  memory: MemoryStore;
  thread: ThreadStore;
  /** 工作空间路径，作为工具执行的默认工作目录 */
  workspace?: string;
  /** 审批判定函数（组合后的），未提供则使用默认策略决策 */
  approvalResolver?: ApprovalDecider;
  events: EventRecorder<TurnEvent>;
  compactor?: ContextCompactor;
  checkpointStore: CheckpointStore;
  logger?: Logger;
}

/** 创建会话（Thread）的选项 */
export interface CreateThreadOptions {
  /** 会话标题，不传则空字符串 */
  title?: string;
  userId?: string;
  /** 工作空间路径，覆盖 agent 默认工作区 */
  workspace?: string;
  /** 自定义元数据（JSON 可序列化） */
  metadata?: {[key: string]: unknown};
}

/**
 * Agent — 对外契约。
 * 定义配置字段与对话入口（invoke / stream / on / off）。
 * 默认实现为 {@link LoopAgent}。
 */
export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly systemPrompt: string;
  readonly modelClient: ModelClient;
  readonly temperature: number;
  readonly reasoning?: ReasoningEffort;
  readonly maxTokens?: number;
  readonly maxSteps: number;
  readonly skills: Skill[];
  readonly tools: Tool[];
  readonly memory: MemoryStore;
  readonly thread: ThreadStore;
  readonly approvalResolver: ApprovalDecider;
  readonly events: EventRecorder<TurnEvent>;
  readonly workspace?: string;
  readonly compactor?: ContextCompactor;
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
   * 创建新会话（Thread）。
   *
   * @param options - 会话配置（标题、用户、工作区、元数据）
   * @returns 新创建的 Thread
   */
  createThread(options?: CreateThreadOptions): Promise<Thread>;

  /**
   * 发起一次对话：发送消息并等待返回最终结果（非流式）。
   *
   * @param message - 用户消息
   * @param options - 调用可选参数
   * @returns turn 最终结果
   */
  invoke(message: UserMessage, options?: RunOptions): Promise<TurnResult>;

  /**
   * 流式对话 — 返回 TurnOutput，含 ReadableStream 流和 result Promise。
   *
   * @param message - 用户消息
   * @param options - turn 运行可选参数
   */
  stream(message: UserMessage, options?: RunOptions): Promise<TurnOutput>;

  /**
   * 主动压缩指定会话：忽略 token 阈值，压缩除最近保留 turn 外的全部已完成 turn。
   * 无可用区间时返回 null（不写库）；thread 不存在或未配置 compactor 返回 null。
   *
   * @param threadId - 会话 ID
   * @param signal - 可选中断信号
   */
  compactThread(threadId: string, signal?: AbortSignal): Promise<CompactionResult | null>;
}

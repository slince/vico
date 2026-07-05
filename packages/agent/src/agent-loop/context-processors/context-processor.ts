// @vico/agent - ContextProcessor onion model: ordered pipeline of prompt modifiers
import type {ModelMessage} from '../../model/types.js';
import type {Tool} from '../../tool/types.js';
import type {Thread} from '../../thread/types.js';
import {Step, TurnSession} from "../agent-loop-options.js";

/** 上下文中的 Agent 引用 — 提供处理器所需的配置字段 */
export interface AgentRef {
  id: string;
  name: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxSteps: number;
}

/** 优先级常量 — 预定义三个档位，用户可自定义任意整数 */
export const Priority = {
  /** 高优先级（最外层，最先执行） */
  HIGH: -100,
  /** 普通优先级 */
  NORMAL: 0,
  /** 低优先级（最内层，最后执行） */
  LOW: 100,
} as const;

/** 穿过洋葱各层的可变上下文 */
export class ModelRequestContext {
  /** Agent 配置（只读引用） */
  readonly agent: AgentRef;
  /** 系统提示词 — 处理器追加内容 */
  systemPrompt: string;
  /** 当前用户消息 */
  readonly userMessage: ModelMessage;
  /** 消息列表 — 处理器可追加 history（unshift）和 system/memory 消息（push） */
  messages: ModelMessage[];
  /** 暴露给 LLM 的工具 */
  tools: Tool[];
  /** 当前 turn 会话（身份 + 线程引用） */
  readonly session?: TurnSession;
  /** 当前 step（一次 LLM 调用 + 可选工具执行） */
  step?: Step;

  constructor(init: {
    agent: AgentRef;
    userMessage?: ModelMessage;
    messages?: ModelMessage[];
    systemPrompt?: string;
    tools?: Tool[];
    session?: TurnSession;
    step?: Step;
  }) {
    this.agent = init.agent;
    this.userMessage = init.userMessage ?? init.messages?.find(m => m.role === 'user')!;
    this.messages = init.userMessage ? [init.userMessage] : (init.messages ?? []);
    this.systemPrompt = init.systemPrompt ?? '';
    this.tools = init.tools ?? [];
    this.session = init.session;
    this.step = init.step;
  }

  /** 便捷获取当前线程 */
  get thread(): Thread | undefined {
    return this.session?.thread;
  }

  /**
   * 便捷获取 threadId。
   *
   * @returns 线程 ID，无线程时返回空字符串
   */
  get threadId(): string {
    return this.session?.thread.id ?? '';
  }

  /** 便捷获取工作记忆作用域标识 */
  get scopeId(): string {
    return this.session?.scopeId ?? '';
  }

  /**
   * 获取最后一条用户消息内容。
   *
   * @returns 最后一条用户消息的文本内容，无用户消息时返回空字符串
   */
  getLastUserMessage(): string {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') return this.messages[i].content;
    }
    return '';
  }
}

/**
 * 上下文处理器 — 洋葱模型的一层。
 * 在 model 调用前按优先级依次执行（process），循环结束后逆序执行（resolve）。
 */
export interface ContextProcessor {
  /** 处理器名称（用于日志/调试） */
  readonly name: string;
  /** 优先级，越小越外层（先执行） */
  readonly priority: number;
  /** 进入阶段：model 调用前修改上下文 */
  process(ctx: ModelRequestContext): Promise<void>;
  /** 离开阶段：整个循环结束后逆序执行，用于提取记忆、后处理等 */
  resolve?(ctx: ModelRequestContext): Promise<void>;
}

/** 洋葱管道 — 按优先级排序后依次执行所有处理器 */
export class ProcessorPipeline {
  /** 升序排列（enter 用） */
  private readonly asc: ContextProcessor[];
  /** 降序排列（leave 用） */
  private readonly desc: ContextProcessor[];

  constructor(private readonly processors: ContextProcessor[]) {
    const sorted = [...processors].sort((a, b) => a.priority - b.priority);
    this.asc = sorted;
    this.desc = [...sorted].reverse();
  }

  /**
   * 进入阶段：按优先级升序依次执行 process()。
   * 单个处理器异常不阻塞后续处理器。
   *
   * @param ctx - 模型请求上下文
   */
  async enter(ctx: ModelRequestContext): Promise<void> {
    for (const processor of this.asc) {
      try {
        await processor.process(ctx);
      } catch (err) {
        console.warn(
          `[ProcessorPipeline] Processor "${processor.name}" (priority ${processor.priority}) threw:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /**
   * 离开阶段：循环结束后，按优先级降序（内层先执行）执行 resolve()。
   * 不抛异常，不阻塞后续处理器。
   *
   * @param ctx - 模型请求上下文
   */
  async leave(ctx: ModelRequestContext): Promise<void> {
    for (const processor of this.desc) {
      if (!processor.resolve) continue;
      try {
        await processor.resolve(ctx);
      } catch (err) {
        console.warn(
          `[ProcessorPipeline] Processor "${processor.name}" resolve threw:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

/**
 * 从 ModelRequestContext 提取 streamText 所需参数。
 *
 * @param ctx - 模型请求上下文
 * @returns 包含 system、messages、tools、maxTokens、temperature 的请求对象
 */
export function buildModelRequest(ctx: ModelRequestContext) {
  return {
    system: ctx.systemPrompt || undefined,
    messages: ctx.messages,
    tools: ctx.tools,
    maxTokens: ctx.agent.maxTokens,
    temperature: ctx.agent.temperature,
  };
}

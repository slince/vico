// @vico/agent - ContextProcessor onion model: ordered pipeline of prompt modifiers
import type {AgentConfig} from '../agent-loop/types.js';
import type {ModelMessage, ModelRequest} from '../model/types.js';
import type {ToolSpec} from '../tool/types.js';

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
  readonly agent: AgentConfig;
  /** 系统提示词 — 处理器追加内容 */
  systemPrompt: string;
  /** 消息列表 — 处理器可追加 system 消息 */
  messages: ModelMessage[];
  /** 暴露给 LLM 的工具 */
  tools: ToolSpec[];
  /** 当前线程标识 */
  threadId: string;
  /** 工作记忆作用域标识（userId 或 workspace 路径） */
  scopeId: string;

  constructor(init: {
    agent: AgentConfig;
    systemPrompt?: string;
    messages?: ModelMessage[];
    tools?: ToolSpec[];
    threadId?: string;
    scopeId?: string;
  }) {
    this.agent = init.agent;
    this.systemPrompt = init.systemPrompt ?? '';
    this.messages = init.messages ?? [];
    this.tools = init.tools ?? [];
    this.threadId = init.threadId ?? '';
    this.scopeId = init.scopeId ?? '';
  }

  /** 获取最后一条用户消息内容 */
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
  constructor(private readonly processors: ContextProcessor[]) {}

  /** 进入阶段：按优先级升序依次执行 process()。单个处理器异常不阻塞后续处理器。 */
  async run(ctx: ModelRequestContext): Promise<void> {
    const sorted = [...this.processors].sort((a, b) => a.priority - b.priority);
    for (const processor of sorted) {
      try {
        await processor.process(ctx);
      } catch (err) {
        console.warn(
          `[OnionPipeline] Processor "${processor.name}" (priority ${processor.priority}) threw:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  /** 离开阶段：循环结束后，按优先级降序（内层先执行）执行 resolve()。不抛异常，不阻塞后续处理器。 */
  async resolve(ctx: ModelRequestContext): Promise<void> {
    const sorted = [...this.processors].sort((a, b) => b.priority - a.priority);
    for (const processor of sorted) {
      if (!processor.resolve) continue;
      try {
        await processor.resolve(ctx);
      } catch (err) {
        console.warn(
          `[OnionPipeline] Processor "${processor.name}" resolve threw:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
}

/** 将处理完成的 ModelRequestContext 转换为 ModelRequest */
export function buildModelRequest(ctx: ModelRequestContext): ModelRequest {
  return {
    system: ctx.systemPrompt || undefined,
    messages: ctx.messages,
    tools: ctx.tools,
    maxTokens: ctx.agent.maxTokens,
    temperature: ctx.agent.temperature,
    abortSignal: new AbortController().signal, // caller overrides
  };
}

// @vico/agent - ContextProcessor onion model: ordered pipeline of prompt modifiers
import type { AgentConfig } from '../contracts/agent.js';
import type { ModelMessage, ModelRequest } from '../model/types.js';
import type { ToolSpec } from '../contracts/tool.js';

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
export interface ModelRequestContext {
  /** Agent 配置（只读引用） */
  readonly agent: AgentConfig;
  /** 系统提示词 — 处理器追加内容 */
  systemPrompt: string;
  /** 消息列表 — 处理器可追加 system 消息 */
  messages: ModelMessage[];
  /** 暴露给 LLM 的工具 */
  tools: ToolSpec[];
}

/**
 * 上下文处理器 — 洋葱模型的一层。
 * 在 model 调用前按优先级依次执行，修改 ModelRequestContext。
 */
export interface ContextProcessor {
  /** 处理器名称（用于日志/调试） */
  readonly name: string;
  /** 优先级，越小越外层（先执行） */
  readonly priority: number;
  /** 处理上下文，可异步 */
  process(ctx: ModelRequestContext): Promise<void>;
}

/** 洋葱管道 — 按优先级排序后依次执行所有处理器 */
export class OnionPipeline {
  constructor(private readonly processors: ContextProcessor[]) {}

  /** 按优先级升序执行所有处理器。单个处理器异常不阻塞后续处理器。 */
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

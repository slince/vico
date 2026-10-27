// @vico/context - ContextProcessor：基于 @vico/utils 洋葱模型的上下文处理器
import type {ModelRequestContext} from './model-request-context.js';
import type {Next, PriorityMiddleware} from '@vico/utils';

/** 优先级常量 — 预定义三个档位，用户可自定义任意整数 */
export const Priority = {
  /** 高优先级（最外层，最先执行） */
  HIGH: -100,
  /** 普通优先级 */
  NORMAL: 0,
  /** 低优先级（最内层，最后执行） */
  LOW: 100,
} as const;

/**
 * 上下文处理器 — 洋葱模型的一层。
 *
 * 实现为带优先级的类中间件（与 @vico/utils 的 PriorityMiddleware 同构，额外多 name 用于日志）：
 * - `priority` 越小越靠外（先执行）；
 * - `handle(ctx, next)` 中，`next()` 前为进入阶段（model 调用前修改上下文），
 *   `next()` 返回后为离开阶段（提取记忆、后处理等）。
 *
 * 语义约定：
 * - 只在进入阶段做事的处理器，直接在末尾 `await next()` 放行；
 * - 想短路时可不调用 `next()`（后续内层与核心都不会执行）；
 * - 离开阶段（next() 后）抛错会向外传播，非关键路径请自行 try-catch 静默。
 */
export interface ContextProcessor extends PriorityMiddleware<ModelRequestContext>{
  /** 处理器名称（用于日志/调试） */
  readonly name: string;
  /** 洋葱层入口：next() 前做前置、next() 后做后置，返回 void 或 Promise<void> */
  handle(ctx: ModelRequestContext, next: Next): void | Promise<void>;
}

/**
 * 从 ModelRequestContext 提取 streamText 所需参数。
 *
 * @param ctx - 模型请求上下文
 * @returns 包含 system、messages、tools、maxTokens、temperature 的请求对象
 */
export function buildModelRequest(ctx: ModelRequestContext) {
  return {
    system: ctx.systemPrompt.render() || undefined,
    messages: ctx.messages,
    tools: ctx.tools.list(),
    maxTokens: ctx.agent.maxTokens,
    temperature: ctx.agent.temperature,
  };
}

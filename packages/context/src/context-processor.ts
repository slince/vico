// @vico/context - ContextProcessor：基于 @vico/utils 洋葱模型的上下文处理器
import type {ModelRequestContext} from './model-request-context.js';
import type {Next} from '@vico/utils';
import {Pipeline} from '@vico/utils';

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
export interface ContextProcessor {
  /** 处理器名称（用于日志/调试） */
  readonly name: string;
  /** 优先级，越小越外层（先执行） */
  readonly priority: number;
  /** 洋葱层入口：next() 前做前置、next() 后做后置，返回 void 或 Promise<void> */
  handle(ctx: ModelRequestContext, next: Next): void | Promise<void>;
}

/**
 * 洋葱管道 — 基于 @vico/utils 的 Pipeline，把一组 ContextProcessor 组装成洋葱链。
 *
 * 层序由 Pipeline 内部按 priority 升序统一决定（同优先级保持传入顺序），
 * 无需再手动排序。
 */
export class ProcessorPipeline {
  private readonly pipeline = new Pipeline<ModelRequestContext>();

  constructor(readonly processors: ContextProcessor[]) {
    this.pipeline.use(...processors);
  }

  /**
   * 触发洋葱执行：处理器按 priority 升序进入，最内层落到传入的核心 core，
   * core 返回后按逆序执行各层的离开阶段。
   *
   * @param ctx - 模型请求上下文
   * @param core - 最内层核心（如实际 model 循环），可选；未传时落到空操作
   * @returns 全部层返回后的 Promise（异常会向外传播）
   */
  execute(ctx: ModelRequestContext, core?: Next): Promise<void> {
    return this.pipeline.execute(ctx, core);
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
    system: ctx.getSystemPrompt() || undefined,
    messages: ctx.messages,
    tools: ctx.tools,
    maxTokens: ctx.agent.maxTokens,
    temperature: ctx.agent.temperature,
  };
}

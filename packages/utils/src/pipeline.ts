// @vico/utils - 洋葱模型 Pipeline：链式收集中间件，execute 统一触发执行

import { compose, type Middleware, type Next } from './compose.js';

/**
 * 洋葱执行器的链式封装：use() 收集中间件，execute() 用 compose 触发执行。
 *
 * 与直接调用 compose 等价，仅提供更顺手的链式 API：
 *   const pipeline = new Pipeline<Ctx>().use(a, b);
 *   await pipeline.execute(ctx, core);
 *
 * 层顺序由 compose 统一决定：带优先级的类按 priority 升序（越小越靠外），
 * 函数式中间件取默认优先级 {@link DEFAULT_PRIORITY}，同优先级保持 use 的相对顺序。
 * 中间件栈可复用：同一实例可对不同 ctx 反复 execute。
 */
export class Pipeline<TContext> {
  /** 已收集的中间件（函数式或带优先级的类），最终顺序由 compose 排序决定 */
  private middlewares: Middleware<TContext>[] = [];

  /**
   * 追加一个或多个中间件；返回 this 以支持链式调用。
   *
   * @param middlewares - 待加入的中间件（函数式或带优先级的类）
   * @returns this
   */
  use(...middlewares: Middleware<TContext>[]): this {
    this.middlewares.push(...middlewares);
    return this;
  }

  /**
   * 触发洋葱执行：从外到内跑一遍中间件，最内层落到传入的核心 core（未传则空操作）。
   *
   * @param ctx - 透传给每一层中间件的上下文
   * @param core - 最内层核心处理器，可选
   * @returns 全部层返回后的 Promise（异常会向外传播）
   */
  execute(ctx: TContext, core?: Next): Promise<void> {
    return compose(this.middlewares)(ctx, core);
  }
}

// @vico/utils - 洋葱模型：Koa 风格 compose，中间件从外到内进入、从内到外返回

/** next 函数：调用后进入下一层（更内层），核心执行完（或没有更多层时）resolve */
export type Next = () => Promise<void>;

/** 中间件：拿 ctx 和 next。在 next 前做前置、next 后做后置；可短路（不调 next）或抛错向外传播 */
export type Middleware<TContext> = (ctx: TContext, next: Next) => void | Promise<void>;

/**
 * 将一组中间件组合成洋葱式调用链，返回可复用的执行函数。
 *
 * 执行时 middlewares[0] 最先进入、最后返回；每层调用 next() 才进入下一层，
 * 最内层落到调用方传入的核心 next（未传则视为空操作）。next() 在同一层只能调一次。
 *
 * @param middlewares - 中间件数组，下标越小越靠外
 * @returns 接收 ctx 与可选核心 next 的执行函数，始终返回 Promise<void>
 */
export function compose<TContext>(middlewares: Middleware<TContext>[]): (ctx: TContext, next?: Next) => Promise<void> {
  return function (ctx: TContext, next?: Next): Promise<void> {
    // 已进入过的最深层下标，用于拦截同一层重复调用 next()
    let lastIndex = -1;

    return dispatch(0);

    /**
     * 分发到第 i 层；i 越界时落到核心 next，无核心则 resolve。
     */
    function dispatch(i: number): Promise<void> {
      // next() 被同一层调用多次，属于用法错误
      if (i <= lastIndex) {
        return Promise.reject(new Error('next() called multiple times'));
      }
      lastIndex = i;

      // 数组取尽：进入调用方传入的核心（最内层）
      if (i === middlewares.length) {
        return next ? Promise.resolve(next()) : Promise.resolve();
      }

      const middleware = middlewares[i];
      try {
        // 同步返回也统一包成 Promise；把「进入下一层」作为 next 交给当前中间件
        return Promise.resolve(middleware(ctx, dispatch.bind(null, i + 1)));
      } catch (err) {
        // 中间件同步抛错，转成 rejected Promise 沿洋葱向外传播
        return Promise.reject(err);
      }
    }
  };
}

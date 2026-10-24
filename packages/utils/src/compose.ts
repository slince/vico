// @vico/utils - 洋葱模型：Koa 风格 compose，中间件按优先级从外到内进入、从内到外返回

/** next 函数：调用后进入下一层（更内层），核心执行完（或没有更多层时）resolve */
export type Next = () => Promise<void>;

/** 函数式中间件：拿 ctx 和 next；在 next 前做前置、next 后做后置，可短路（不调 next）或抛错向外传播 */
export type MiddlewareFn<TContext> = (ctx: TContext, next: Next) => void | Promise<void>;

/** 带优先级的类中间件：priority 越小越靠外（先执行）；handle 语义同函数式中间件 */
export interface PriorityMiddleware<TContext> {
  /** 优先级，越小越靠外（先执行） */
  readonly priority: number;
  /** 层入口：ctx + next，语义与函数式中间件一致 */
  handle(ctx: TContext, next: Next): void | Promise<void>;
}

/** 中间件：函数式或带优先级的类 */
export type Middleware<TContext> = MiddlewareFn<TContext> | PriorityMiddleware<TContext>;

/** 函数式中间件的默认优先级（与 context 包 Priority.NORMAL = 0 对齐） */
export const DEFAULT_PRIORITY = 0;

/** 归一化后的中间件：拆出优先级 + 可调用的纯函数 */
interface NormalizedMiddleware<TContext> {
  priority: number;
  handler: MiddlewareFn<TContext>;
}

/** 把函数式/类中间件统一归一化为 { priority, handler } */
function normalize<TContext>(mw: Middleware<TContext>): NormalizedMiddleware<TContext> {
  if (typeof mw === 'function') {
    return { priority: DEFAULT_PRIORITY, handler: mw };
  }
  return { priority: mw.priority, handler: (ctx, next) => mw.handle(ctx, next) };
}

/**
 * 将一组中间件组合成洋葱式调用链，返回可复用的执行函数。
 *
 * 中间件先按 priority 升序排列（越小越靠外，同优先级保持传入相对顺序），
 * 再按 Koa 语义执行：每层调用 next() 才进入下一层，最内层落到调用方传入的核心
 * next（未传则视为空操作）。next() 在同一层只能调一次。
 *
 * @param middlewares - 中间件数组（函数式或带优先级的类）
 * @returns 接收 ctx 与可选核心 next 的执行函数，始终返回 Promise<void>
 */
export function compose<TContext>(middlewares: Middleware<TContext>[]): (ctx: TContext, next?: Next) => Promise<void> {
  // 归一化 + 升序排序，dispatch 只跟纯函数打交道
  const sorted = [...middlewares]
    .map(normalize)
    .sort((a, b) => a.priority - b.priority)
    .map((m) => m.handler);

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
      if (i === sorted.length) {
        return next ? Promise.resolve(next()) : Promise.resolve();
      }

      const middleware = sorted[i];
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

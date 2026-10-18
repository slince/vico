// @vico/di - 轻量依赖注入容器实现（工厂 Provider + 配置注入 + 作用域 + 异步解析）

import type {
  Factory,
  FactoryContext,
  RegisterOptions,
  Scope,
  TokenMap,
} from './types.js';

/**
 * 内部注册表项：保存工厂、作用域与单例缓存状态。
 *
 * `resolved` 与 `instance` 分离：单例解析结果可能是 `undefined`（合法值），
 * 不能靠 `instance` 是否存在判断「是否已解析」，故用布尔标记。
 */
interface Registration<TValue, TConfig, TTokens extends TokenMap> {
  factory: Factory<TValue, TConfig, TTokens>;
  scope: Scope;
  /** singleton 是否已成功解析过 */
  resolved: boolean;
  /** singleton 已解析出的实例值（值为 undefined 时靠 `resolved` 区分） */
  instance?: TValue;
  /** singleton 异步解析进行中的共享 Promise，并发 `resolveAsync` 去重用 */
  pending?: Promise<TValue>;
}

/**
 * 轻量、类型安全的依赖注入容器。
 *
 * 职责：
 * 1. 依赖解析——工厂里通过 `ctx.resolve` 递归获取其他依赖；
 * 2. 配置驱动构建——`config` 在容器构造时注入，工厂里通过 `ctx.config` 读取
 *    配置切片，并按配置做条件构建（如 s3/local 切实现）。
 *
 * 作用域：默认 `singleton`（全容器唯一），可注册为 `transient`（每次新建）。
 * 异步：工厂返回 `Promise` 时用 `resolveAsync` 解析，并发调用共享同一个
 * pending Promise（去重，工厂只执行一次）。
 *
 * @typeParam TConfig 配置对象类型
 * @typeParam TTokens Token 映射表（token 名 → 实例类型）
 */
export class Container<TConfig, TTokens extends TokenMap> {
  private readonly registrations = new Map<string, Registration<unknown, TConfig, TTokens>>();
  /** 正在解析中的 token，用于循环依赖检测（同步/异步解析共享） */
  private readonly resolving = new Set<string>();

  constructor(private readonly config: TConfig) {}

  /**
   * 注册一个工厂 Provider：解析 `token` 时调用 `factory` 构建实例。
   *
   * @param token 依赖标识，必须是 `TTokens` 中声明的 key
   * @param factory 工厂函数，读配置 + 依赖产出实例；返回 Promise 表示异步构建
   * @param options 注册选项（作用域），默认 singleton
   */
  register<K extends keyof TTokens & string>(
    token: K,
    factory: Factory<TTokens[K], TConfig, TTokens>,
    options?: RegisterOptions,
  ): this {
    if (this.registrations.has(token)) {
      throw new Error(`[di] 重复注册: ${String(token)}`);
    }
    this.registrations.set(token, {
      factory: factory as Factory<unknown, TConfig, TTokens>,
      scope: options?.scope ?? 'singleton',
      resolved: false,
    });
    return this;
  }

  /**
   * 注册一个已构建好的实例（等价于 `register(token, () => value)`）。
   * 适合注入外部已初始化的单例或常量配置切片。
   */
  registerValue<K extends keyof TTokens & string>(token: K, value: TTokens[K]): this {
    return this.register(token, () => value);
  }

  /**
   * 同步解析依赖。
   *
   * - singleton：首次解析后缓存实例，后续直接返回缓存；
   * - transient：每次调用工厂新建；
   * - 工厂返回 Promise 时抛错（异步工厂必须用 `resolveAsync`）。
   *
   * @throws 未注册的 token、循环依赖、异步工厂被同步解析
   */
  resolve<K extends keyof TTokens & string>(token: K): TTokens[K] {
    const reg = this.getRegistration(token);
    if (reg.scope === 'singleton' && reg.resolved) {
      return reg.instance as TTokens[K];
    }
    this.enterResolving(token);
    try {
      const value = reg.factory(this.buildContext());
      // 异步工厂被同步 resolve：结果必然无法同步取得，提示改用 resolveAsync
      if (value instanceof Promise) {
        throw new Error(`[di] 工厂 "${String(token)}" 返回 Promise，请使用 resolveAsync()`);
      }
      if (reg.scope === 'singleton') {
        reg.resolved = true;
        reg.instance = value;
      }
      return value as TTokens[K];
    } finally {
      this.resolving.delete(token);
    }
  }

  /**
   * 异步解析依赖：支持工厂返回 Promise（也兼容同步工厂）。
   *
   * singleton 语义下，并发调用共享同一个 pending Promise，工厂只执行一次；
   * 工厂失败时清空 pending 缓存，允许下次重试。
   *
   * @throws 未注册的 token、循环依赖
   */
  async resolveAsync<K extends keyof TTokens & string>(token: K): Promise<TTokens[K]> {
    const reg = this.getRegistration(token);
    if (reg.scope === 'singleton') {
      if (reg.resolved) return reg.instance as TTokens[K];
      if (reg.pending) return reg.pending as Promise<TTokens[K]>;
    }
    this.enterResolving(token);
    // 先登记 pending 再执行工厂（工厂在微任务中运行），保证并发 await 命中同一 Promise
    const pending = Promise.resolve().then(() => reg.factory(this.buildContext()));
    if (reg.scope === 'singleton') {
      reg.pending = pending;
    }
    try {
      const value = await pending;
      if (reg.scope === 'singleton') {
        reg.resolved = true;
        reg.instance = value;
        reg.pending = undefined;
      }
      return value as TTokens[K];
    } catch (err) {
      // 构建失败不缓存，清掉 pending 让下次解析重试
      if (reg.scope === 'singleton') {
        reg.pending = undefined;
      }
      throw err;
    } finally {
      this.resolving.delete(token);
    }
  }

  /** 判断 token 是否已注册 */
  has(token: string): boolean {
    return this.registrations.has(token);
  }

  /** 取出注册项，未注册时抛错 */
  private getRegistration(token: string): Registration<unknown, TConfig, TTokens> {
    const reg = this.registrations.get(token);
    if (!reg) {
      throw new Error(`[di] 未注册的依赖: ${token}`);
    }
    return reg;
  }

  /** 进入解析前做循环依赖检测并登记 */
  private enterResolving(token: string): void {
    if (this.resolving.has(token)) {
      throw new Error(`[di] 检测到循环依赖: ${token}`);
    }
    this.resolving.add(token);
  }

  /** 构建传给工厂的上下文：配置 + 同步依赖解析器 */
  private buildContext(): FactoryContext<TConfig, TTokens> {
    return {
      config: this.config,
      resolve: <K extends keyof TTokens & string>(token: K): TTokens[K] => this.resolve(token),
    };
  }
}

/**
 * 创建容器。`config` 为注入工厂的只读配置（可省略）。
 *
 * @typeParam TConfig 配置对象类型（缺省 undefined）
 * @typeParam TTokens Token 映射表，显式声明后获得类型安全的 `register` / `resolve`
 *
 * @example
 * ```ts
 * interface Tokens { db: Db; storage: Storage }
 * const container = createContainer<AppConfig, Tokens>(config);
 * container.register('storage', ({ config, resolve }) =>
 *   config.storage.type === 's3'
 *     ? new S3Storage(config.storage, resolve('db'))
 *     : new LocalStorage(config.storage, resolve('db')),
 * );
 * ```
 */
export function createContainer<TConfig = undefined, TTokens extends TokenMap = Record<string, unknown>>(
  config: TConfig = undefined as TConfig,
): Container<TConfig, TTokens> {
  return new Container<TConfig, TTokens>(config);
}

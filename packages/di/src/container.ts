// @vico/di - 轻量依赖注入容器实现（工厂 Provider + 配置注入 + 作用域 + 异步解析 + 配置加载）

import { readFileSync } from 'node:fs';
import { extname, resolve as resolvePath } from 'node:path';
import { ZodError, type z } from 'zod';
import { parse as parseYaml } from 'yaml';
import type {
  ConfigSchemaMap,
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
interface Registration<
  TValue,
  TConfig,
  TTokens extends TokenMap,
  TConfigKeys extends ConfigSchemaMap,
> {
  factory: Factory<TValue, TConfig, TTokens, TConfigKeys>;
  scope: Scope;
  /** singleton 是否已成功解析过 */
  resolved: boolean;
  /** singleton 已解析出的实例值（值为 undefined 时靠 `resolved` 区分） */
  instance?: TValue;
  /** singleton 异步解析进行中的共享 Promise，并发 `resolveAsync` 去重用 */
  pending?: Promise<TValue>;
}

/** 已注册配置的内部状态 */
interface ConfigRegistration {
  schema: z.ZodType;
  /** 是否已成功解析出值（值为 undefined 时靠它区分） */
  hasValue: boolean;
  /** 已验证的配置值 */
  value?: unknown;
}

/**
 * Service Provider：负责把某个领域的一组服务绑定进容器（register），
 * 并在全部 provider 注册完成后统一初始化（boot）。
 *
 * 两阶段约定：
 * 1. `register` 只做绑定（register / registerConfig / load），不实例化、不做副作用；
 * 2. `boot`（可选）在所有 provider 都 register 完后按声明顺序调用，此时可安全
 *    resolve 依赖、执行异步初始化（建连、迁移、预热等）。
 *
 * 两者均可返回 Promise，由 `Container.registerProvider` / `Container.boot` 依次等待。
 */
export interface ServiceProvider<
  TConfig,
  TTokens extends TokenMap,
  TConfigKeys extends ConfigSchemaMap,
> {
  /** 阶段一：只做绑定，不实例化、不做副作用 */
  register(container: Container<TConfig, TTokens, TConfigKeys>): void | Promise<void>;
  /** 阶段二：所有 provider 注册完成后调用，可 resolve 依赖、执行初始化 */
  boot?(container: Container<TConfig, TTokens, TConfigKeys>): void | Promise<void>;
}

/**
 * 轻量、类型安全的依赖注入容器。
 *
 * 职责：
 * 1. 依赖解析——工厂 Provider 通过 `ctx.resolve` 递归获取其他依赖；
 * 2. 配置驱动构建——`config` 构造时注入，工厂通过 `ctx.config` 读取配置切片并条件构建对象；
 * 3. 配置定义加载——`registerConfig` 声明配置段的 zod schema，`load` 从 yaml/json
 *    文件读取并按 schema 验证，`getConfig`（或工厂内 `ctx.getConfig`）取用。
 *
 * 作用域：默认 `singleton`（全容器唯一），可注册为 `transient`（每次新建）。
 * 异步：工厂返回 `Promise` 时用 `resolveAsync` 解析，并发调用共享同一个
 * pending Promise（去重，工厂只执行一次）。
 *
 * @typeParam TConfig 配置对象类型
 * @typeParam TTokens Token 映射表（token 名 → 实例类型）
 * @typeParam TConfigKeys 配置 schema 映射表（配置名 → zod schema 类型）
 */
export class Container<
  TConfig,
  TTokens extends TokenMap,
  TConfigKeys extends ConfigSchemaMap,
> {
  private readonly registrations = new Map<
    string,
    Registration<unknown, TConfig, TTokens, TConfigKeys>
  >();
  /** 正在解析中的 token，用于循环依赖检测（同步/异步解析共享） */
  private readonly resolving = new Set<string>();
  /** 已注册的配置 schema 及验证结果 */
  private readonly configs = new Map<string, ConfigRegistration>();
  /** 已按 register 顺序登记的 providers，`boot()` 时依序触发其 boot 钩子 */
  private readonly providers: ServiceProvider<TConfig, TTokens, TConfigKeys>[] = [];
  /** 是否已冻结：load / boot / 首次 resolve 完成后自动冻结，禁止再注入 service */
  private frozen = false;

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
    factory: Factory<TTokens[K], TConfig, TTokens, TConfigKeys>,
    options?: RegisterOptions,
  ): this {
    this.assertNotFrozen(`register "${String(token)}"`);
    if (this.registrations.has(token)) {
      throw new Error(`[di] Duplicate registration: ${String(token)}`);
    }
    this.registrations.set(token, {
      factory: factory as Factory<unknown, TConfig, TTokens, TConfigKeys>,
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
   * 声明一个配置段：`key` 及其 zod schema。
   *
   * 必须先在 `load` 之前声明（`load` 成功后容器即冻结，无法再补声明），
   * 后续 `load` 读到该 key 时用 schema 验证。
   *
   * @param key 配置名，必须是 `TConfigKeys` 中声明的 key
   * @param schema zod schema，`getConfig` 返回 `z.infer` 后的类型
   */
  registerConfig<K extends keyof TConfigKeys & string>(
    key: K,
    schema: TConfigKeys[K] & z.ZodType,
  ): this {
    this.assertNotFrozen(`register config "${String(key)}"`);
    if (this.configs.has(key)) {
      throw new Error(`[di] Duplicate config registration: ${String(key)}`);
    }
    this.configs.set(key, { schema, hasValue: false });
    return this;
  }

  /**
   * 加载一个 yaml/json 配置文件（可多次调用加载多个文件）。
   *
   * 文件顶层必须是「配置名 → 值」的对象；对已注册的 key 立即用 schema 验证
   * （失败抛错），未注册的 key 忽略（schema 必须在 load 前声明）。
   * 多次加载时，后加载的同名 key 覆盖先加载的（覆盖后同样重新验证）。
   *
   * 加载成功后容器自动冻结，禁止再注入 service（仍可继续 load 覆盖配置值）。
   *
   * @param path 配置文件路径，相对路径基于进程 cwd
   */
  load(path: string): this {
    const data = readConfigFile(resolvePath(path));
    for (const [key, value] of Object.entries(data)) {
      const reg = this.configs.get(key);
      if (reg) {
        reg.value = parseConfigValue(reg.schema, value, key, path);
        reg.hasValue = true;
      }
      // 未注册的 key 忽略：schema 必须先声明，load 成功后即冻结无法补声明
    }
    this.freeze();
    return this;
  }

  /**
   * 获取已验证的配置段。
   *
   * @throws 未注册的 key、已注册但加载的文件中未提供对应 key
   */
  getConfig<K extends keyof TConfigKeys & string>(key: K): z.infer<TConfigKeys[K] & z.ZodType> {
    const reg = this.configs.get(key);
    if (!reg) {
      throw new Error(`[di] Config not registered: ${String(key)}`);
    }
    if (!reg.hasValue) {
      throw new Error(`[di] Config "${String(key)}" is not provided by any loaded file`);
    }
    return reg.value as z.infer<TConfigKeys[K] & z.ZodType>;
  }

  /**
   * 注册单个 Service Provider：立即执行其 `register`（绑定）阶段。
   *
   * 已注册的 provider 按调用顺序登记，`boot()` 时依此顺序触发各自的 `boot` 钩子。
   * register 可异步，本方法会等待其完成后再登记。
   *
   * @param provider 要注册的 provider（只执行 register 阶段，不触发 boot）
   */
  async registerProvider(provider: ServiceProvider<TConfig, TTokens, TConfigKeys>): Promise<void> {
    this.assertNotFrozen('register a service provider');
    await provider.register(this);
    this.providers.push(provider);
  }

  /**
   * 触发所有已通过 `registerProvider` 登记的 provider 的 `boot` 钩子。
   *
   * 按登记顺序依次调用（boot 可异步，逐个等待）。至此全部 provider 的 register
   * 阶段已完成，各 boot 可安全 resolve 依赖、执行异步初始化（建连、迁移、预热等）。
   *
   * 由调用方自行调度：先 `registerProvider` 全部绑定，再统一 `boot`。
   * boot 完成后容器自动冻结，禁止再注入 service。
   */
  async boot(): Promise<void> {
    for (const provider of this.providers) {
      await provider.boot?.(this);
    }
    this.freeze();
  }

  /**
   * 冻结容器：禁止后续 register / registerValue / registerConfig / registerProvider。
   *
   * 装配完成后应冻结，阻止运行时再注入依赖，保证依赖图在启动期定型。
   * `load` / `boot` / `resolve` / `resolveAsync` 成功完成后都会自动冻结，
   * 通常无需手动调用；仅在确需提前冻结（尚未 load/boot/resolve）时显式调用。
   */
  freeze(): this {
    this.frozen = true;
    return this;
  }

  /** 容器是否已冻结 */
  get isFrozen(): boolean {
    return this.frozen;
  }

  /** 冻结状态下拒绝任何注册动作 */
  private assertNotFrozen(action: string): void {
    if (this.frozen) {
      throw new Error(`[di] Container is frozen: cannot ${action}`);
    }
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
        throw new Error(`[di] Factory "${String(token)}" returned a Promise, use resolveAsync() instead`);
      }
      if (reg.scope === 'singleton') {
        reg.resolved = true;
        reg.instance = value;
      }
      // 解析完成即冻结，禁止运行时再注入 service
      this.freeze();
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
      // 解析完成即冻结，禁止运行时再注入 service
      this.freeze();
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
  private getRegistration(token: string): Registration<unknown, TConfig, TTokens, TConfigKeys> {
    const reg = this.registrations.get(token);
    if (!reg) {
      throw new Error(`[di] Dependency not registered: ${token}`);
    }
    return reg;
  }

  /** 进入解析前做循环依赖检测并登记 */
  private enterResolving(token: string): void {
    if (this.resolving.has(token)) {
      throw new Error(`[di] Circular dependency detected: ${token}`);
    }
    this.resolving.add(token);
  }

  /** 构建传给工厂的上下文：配置 + 同步依赖解析器 + 配置读取器 */
  private buildContext(): FactoryContext<TConfig, TTokens, TConfigKeys> {
    return {
      config: this.config,
      resolve: <K extends keyof TTokens & string>(token: K): TTokens[K] => this.resolve(token),
      getConfig: <K extends keyof TConfigKeys & string>(key: K) => this.getConfig(key),
    };
  }
}

/**
 * 读取并解析配置文件（yaml/json），返回顶层对象。
 *
 * @throws 文件不存在、解析失败、格式不支持、顶层非对象
 */
function readConfigFile(absPath: string): Record<string, unknown> {
  let text: string;
  try {
    text = readFileSync(absPath, 'utf-8');
  } catch (err) {
    throw new Error(`[di] Failed to read config file: ${absPath}`, { cause: err });
  }

  const ext = extname(absPath).toLowerCase();
  let data: unknown;
  try {
    if (ext === '.yaml' || ext === '.yml') {
      data = parseYaml(text);
    } else if (ext === '.json') {
      data = JSON.parse(text);
    } else {
      throw new Error(`Unsupported format (only .yaml/.yml/.json are supported)`);
    }
  } catch (err) {
    throw new Error(
      `[di] Failed to parse config file: ${absPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`[di] Config file top level must be an object ({ name: value }): ${absPath}`);
  }
  return data as Record<string, unknown>;
}

/**
 * 用 schema 验证配置值；失败时抛出带 key 与来源文件的错误。
 */
function parseConfigValue(schema: z.ZodType, value: unknown, key: string, source: string): unknown {
  try {
    return schema.parse(value);
  } catch (err) {
    const detail = err instanceof ZodError
      ? err.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
      : String(err);
    throw new Error(`[di] Config "${key}" validation failed (source: ${source}): ${detail}`, { cause: err });
  }
}

/**
 * 创建容器。`config` 为注入工厂的只读配置（可省略）。
 *
 * @typeParam TConfig 配置对象类型（缺省 undefined）
 * @typeParam TTokens Token 映射表，显式声明后获得类型安全的 `register` / `resolve`
 * @typeParam TConfigKeys 配置 schema 映射表，显式声明后获得类型安全的 `registerConfig` / `getConfig`
 *
 * @example
 * ```ts
 * interface Tokens { db: Db; storage: Storage }
 * interface ConfigKeys { storage: typeof storageSchema }
 * const container = createContainer<AppConfig, Tokens, ConfigKeys>(config);
 * container
 *   .registerConfig('storage', storageSchema)
 *   .register('storage', ({ getConfig }) => createStorage(getConfig('storage')))
 *   .load('server.config.yaml');
 * ```
 */
export function createContainer<
  TConfig = undefined,
  TTokens extends TokenMap = Record<string, unknown>,
  TConfigKeys extends ConfigSchemaMap = Record<string, z.ZodType>,
>(config: TConfig = undefined as TConfig): Container<TConfig, TTokens, TConfigKeys> {
  return new Container<TConfig, TTokens, TConfigKeys>(config);
}

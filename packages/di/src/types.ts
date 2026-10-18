// @vico/di - 轻量依赖注入容器的类型定义

import type { z } from 'zod';

/**
 * Token 映射表：token 名 → 该 token 解析出的实例类型。
 *
 * 这是容器类型安全的根基：把「字符串 token → 实例类型」的映射显式声明出来，
 * 让 `register` 校验工厂返回类型、让 `resolve` 按 token 推断出正确返回类型。
 *
 * 约束用 `object` 而非 `Record<string, unknown>`：后者要求 index signature，
 * 会导致无 index signature 的 `interface` 无法作为 TokenMap 使用。
 *
 * @example
 * ```ts
 * interface Tokens {
 *   db: Db;
 *   storageManager: StorageManager;
 * }
 * const container = createContainer<Tokens>();
 * const db = container.resolve('db'); // 类型为 Db
 * ```
 */
export type TokenMap = object;

/**
 * 配置 schema 映射表：配置名 → 该配置的 zod schema 类型。
 *
 * 与 TokenMap 对称：声明后 `registerConfig` 校验 schema 类型、`getConfig` 按 key
 * 推断出 `z.infer` 后的配置类型。约束同样用 `object` 以兼容 interface。
 *
 * @example
 * ```ts
 * const memorySchema = z.object({ stm_window: z.number() });
 * interface ConfigKeys { memory: typeof memorySchema }
 * const container = createContainer<Tokens, ConfigKeys>();
 * const memory = container.getConfig('memory'); // 类型为 { stm_window: number }
 * ```
 */
export type ConfigSchemaMap = object;

/**
 * 工厂上下文：工厂函数唯一入参，携带依赖解析器与配置读取器。
 *
 * 依赖与配置在同一个显式位置汇合：`resolve` 递归获取其他依赖，
 * `getConfig` 读取 `registerConfig` + `load` 加载并验证的配置段。
 */
export interface FactoryContext<
  TTokens extends TokenMap,
  TConfigKeys extends ConfigSchemaMap,
> {
  /** 同步解析其他依赖；被解析的依赖必须是同步可解析的，否则请用 `resolveAsync` */
  resolve: <K extends keyof TTokens & string>(token: K) => TTokens[K];
  /** 读取已通过 `registerConfig` + `load` 加载并验证的配置段 */
  getConfig: <K extends keyof TConfigKeys & string>(key: K) => z.infer<TConfigKeys[K] & z.ZodType>;
}

/**
 * 工厂函数：读配置 + 解析依赖，产出实例。
 *
 * 返回 `Promise` 表示异步构建（如需要 `await` 加载模型、建连等），
 * 异步工厂只能通过 `resolveAsync` 解析。
 */
export type Factory<
  TValue,
  TTokens extends TokenMap,
  TConfigKeys extends ConfigSchemaMap,
> = (ctx: FactoryContext<TTokens, TConfigKeys>) => TValue | Promise<TValue>;

/**
 * 实例作用域。
 * - `singleton`：全容器唯一实例（默认）
 * - `transient`：每次解析都新建一个实例，不缓存
 */
export type Scope = 'singleton' | 'transient';

/** `register` 的注册选项 */
export interface RegisterOptions {
  /** 实例作用域，默认 `singleton` */
  scope?: Scope;
}

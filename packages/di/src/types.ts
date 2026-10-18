// @vico/di - 轻量依赖注入容器的类型定义

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
 * const container = createContainer<AppConfig, Tokens>(config);
 * const db = container.resolve('db'); // 类型为 Db
 * ```
 */
export type TokenMap = object;

/**
 * 工厂上下文：工厂函数唯一入参，同时携带配置切片与依赖解析器。
 *
 * 配置与依赖在同一个显式位置汇合，正是「容器除了解析依赖，还要解决配置驱动构建」的落点。
 */
export interface FactoryContext<TConfig, TTokens extends TokenMap> {
  /** 容器构造时注入的只读配置（可能是 undefined，表示无配置） */
  config: TConfig;
  /** 同步解析其他依赖；被解析的依赖必须是同步可解析的，否则请用 `resolveAsync` */
  resolve: <K extends keyof TTokens & string>(token: K) => TTokens[K];
}

/**
 * 工厂函数：读取配置切片 + 依赖，产出实例。
 *
 * 返回 `Promise` 表示异步构建（如需要 `await` 加载模型、建连等），
 * 异步工厂只能通过 `resolveAsync` 解析。
 */
export type Factory<TValue, TConfig, TTokens extends TokenMap> = (
  ctx: FactoryContext<TConfig, TTokens>,
) => TValue | Promise<TValue>;

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

// @vico/di - 轻量、类型安全的依赖注入容器。
//
// 核心职责：
// 1. 依赖解析——工厂 Provider 通过 `ctx.resolve` 递归获取其他依赖；
// 2. 配置定义加载——`registerConfig` 声明 zod schema，`load` 从 yaml/json 读取并验证，
//    `getConfig`（或工厂内 `ctx.getConfig`）取用，配置值驱动工厂条件构建对象。
//
// 特性：类型安全的 TokenMap / ConfigSchemaMap、singleton/transient 作用域、
// 异步工厂（resolveAsync）、并发解析去重、循环依赖检测、多配置文件加载。

export { Container, createContainer } from './container.js';
export type { ServiceProvider } from './container.js';
export type {
  ConfigSchemaMap,
  Factory,
  FactoryContext,
  RegisterOptions,
  Scope,
  TokenMap,
} from './types.js';

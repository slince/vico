// @vico/di - 轻量、类型安全的依赖注入容器。
//
// 核心职责：
// 1. 依赖解析——工厂 Provider 通过 `ctx.resolve` 递归获取其他依赖；
// 2. 配置驱动构建——`config` 构造时注入，工厂通过 `ctx.config` 读配置切片并条件构建对象。
//
// 特性：类型安全的 TokenMap、singleton/transient 作用域、异步工厂（resolveAsync）、
// 并发解析去重、循环依赖检测。

export { Container, createContainer } from './container.js';
export type { Factory, FactoryContext, RegisterOptions, Scope, TokenMap } from './types.js';

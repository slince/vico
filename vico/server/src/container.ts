import type { ServerContainer } from './tokens.js';

let container: ServerContainer | undefined;

/**
 * 记录全局容器单例。
 *
 * 在 `createVicoContainer` 之后、`bootstrap` 之前即调用：boot 阶段的初始化副作用
 * （迁移/建表）需要读取 database 配置，故容器不能等到 bootstrap 完成才可用。
 */
export function setContainer(c: ServerContainer): void {
  container = c;
}

/**
 * 获取全局容器单例。
 *
 * @throws 容器尚未创建时抛错（提示先调用 bootstrap）
 */
export function getContainer(): ServerContainer {
  if (!container) {
    throw new Error('[server] Container not initialized — call bootstrap() first');
  }
  return container;
}

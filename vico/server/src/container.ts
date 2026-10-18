import type { VicoContainer } from '@vico/boot';

let container: VicoContainer | undefined;

/** 记录全局 Vico 容器（由 bootstrap() 在启动完成后调用） */
export function setContainer(c: VicoContainer): void {
  container = c;
}

/**
 * 获取全局 Vico 容器单例。
 *
 * @throws 容器尚未初始化时抛错（提示先调用 bootstrap）
 */
export function getContainer(): VicoContainer {
  if (!container) {
    throw new Error('[server] Container not initialized — call bootstrap() first');
  }
  return container;
}

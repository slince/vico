/**
 * Vico Agent 框架初始化 — 替代 Mastra。
 */
import {Vico} from '@vico/agent';
import {createApp} from './app.js';
import logger from './lib/logger.js';

/** 全局 Vico 容器单例 */
export const vico = new Vico({
  maxCached: 100,
  skills: { skillDirs: ["~/.vico/skills"], compatible: true },
});

/** 创建 Hono app 实例 */
export const app = createApp();

/** 系统初始化 */
export async function initVico(): Promise<void> {
  await vico.init();
  logger.info('Vico agent framework initialized');
}

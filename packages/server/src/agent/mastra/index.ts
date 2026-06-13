// Mastra 实例管理：懒加载单例，对外暴露统一的 Agent 构建入口

import { Mastra } from '@mastra/core';
import { getMastraStorage } from './storage.js';

let mastraInstance: Mastra;

/**
 * 获取 Mastra 实例单例。
 * Mastra 实例统一管理 storage 和全局配置。
 * Agent 由 createMastraAgent() 动态创建，不在此处静态注册。
 */
export function getMastra(): Mastra {
  if (!mastraInstance) {
    mastraInstance = new Mastra({
      storage: getMastraStorage(),
      agents: {},
    });
    console.log('[Mastra] Instance initialized');
  }
  return mastraInstance;
}

export { createMastraAgent } from './agent-factory.js';
export type { PipelineContext } from './agent-factory.js';

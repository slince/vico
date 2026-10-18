// @vico/boot - Agent 运行时领域 provider（事件广播器 + LRU 缓存）

import { AgentRuntime } from '@vico/agent';
import { MittEventRecorder } from '@vico/events';
import type { TurnEvent } from '@vico/stream';
import type { VicoServiceProvider } from '../tokens.js';

/**
 * Agent 运行时 provider：注册 `events`（turn 事件广播）与 `agentRuntime`（LRU 缓存）。
 * 对应已废弃 Vico 类的共享依赖装配。
 */
export const agentProvider: VicoServiceProvider = {
  register(c) {
    c.register('events', () => new MittEventRecorder<TurnEvent>());
    c.register('agentRuntime', ({ getConfig }) => new AgentRuntime(getConfig('agent').max_cached));
  },
};

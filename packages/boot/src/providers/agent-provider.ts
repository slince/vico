// @vico/boot - Agent 运行时领域 provider（对应已废弃的 Vico 类职责）

import type { VicoServiceProvider } from '../tokens.js';

/**
 * Agent 运行时 provider：绑定 `toolExecutor` / `agentRuntime`（替代 Vico 类的一键装配），
 * boot 阶段启动 checkpoint purge 定时器。
 *
 * 迁移时对应 `@vico/agent` 的 `Vico` 类装配逻辑与 checkpoint purge。
 */
export const agentProvider: VicoServiceProvider = {
  register(c) {
    // TODO(迁移): c.register('toolExecutor', ({ getConfig }) => new ToolExecutor({ timeout_ms: getConfig('tool').timeout_ms }));
    // TODO(迁移): c.register('agentRuntime', ({ resolve, getConfig }) => new AgentRuntime({
    //   skills: { skillDirs: getConfig('skills').scan_paths },
    //   tools: [/* workspace 等内置工具 */],
    //   memory: resolve('memory'),
    //   thread: resolve('thread'),
    //   checkpointStore: resolve('checkpointStore'),
    //   compaction: getConfig('memory').compaction,
    // }));
  },
  async boot(c) {
    // TODO(迁移): startCheckpointPurge(
    //   c.resolve('checkpointStore'),
    //   c.getConfig('checkpoint').ttl_days * 24 * 60 * 60 * 1000,
    // );
  },
};

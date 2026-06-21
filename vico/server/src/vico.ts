/**
 * Vico Agent 框架初始化 — 替代 Mastra。
 *
 * 全局单例，统一管理：
 * - Skill 发现（文件系统扫描 + 兼容模式）
 * - MemoryStore（三层记忆 → MemoryProcessor + 记忆工具）
 * - DrizzleThreadStore（持久化 thread/turn/message，默认存储）
 * - EventRecorder / SpanTracker（共享观测设施）
 * - AgentRuntime（LRU 缓存）
 * - defaultModelFactory（自动匹配 OpenAI/Anthropic/DeepSeek 等 provider）
 */
import { Vico, MemoryStore } from '@vico/agent';
import { DrizzleThreadStore, ensureTables } from '@vico/libsql-adapter';
import { getDb } from './db/db.js';
import { createApp } from './app.js';
import logger from './lib/logger.js';

const db = getDb();

/** 全局 Vico 容器单例 */
export const vico = new Vico({
  maxCached: 100,
  skills: { skillDirs: ['~/.vico/skills'], compatible: true },
  memory: new MemoryStore(),
  thread: new DrizzleThreadStore({ db: db as any }),
});

/** 创建 Hono app 实例 */
export const app = createApp();

/** 系统初始化 */
export async function initVico(): Promise<void> {
  // 确保 Vico 持久化表存在（vico_threads / vico_turns / vico_messages / vico_memory_entries）
  await ensureTables(db as any);
  await vico.init();
  logger.info('Vico agent framework initialized');
}

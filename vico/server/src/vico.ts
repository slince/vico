/**
 * Vico Agent 框架初始化 — 替代 Mastra。
 *
 * 全局单例，统一管理：
 * - Skill 发现（文件系统扫描 + 兼容模式）
 * - MemoryStore（三层记忆）
 * - EventRecorder / SpanTracker（共享观测设施）
 * - AgentLoop 工厂（注入完整 processor 链）
 */
import {
  Vico, MemoryStore, Agent, AgentLoop, ToolBroker,
  SystemPromptProcessor, MemoryProcessor,
  createBuiltInToolSource, createUpdateWorkingMemoryTool,
  type ContextProcessor,
} from '@vico/agent';
import type { Tool, ToolSource } from '@vico/agent';
import { createApp } from './app.js';
import logger from './lib/logger.js';

/** 全局 Vico 容器单例 */
export const vico = new Vico({
  maxCached: 100,
  skills: { skillDirs: ['~/.vico/skills'], compatible: true },
  memory: new MemoryStore(),
});

/** 创建 Hono app 实例 */
export const app = createApp();

/** 系统初始化 */
export async function initVico(): Promise<void> {
  await vico.init();
  logger.info('Vico agent framework initialized');
}

/**
 * 为 Agent 构建完整 AgentLoop。
 *
 * 自动注入共享的：
 * - SystemPromptProcessor（agent.config.systemPrompt）
 * - MemoryProcessor（Vico 全局 MemoryStore）
 * - 内置工具源（文件读写、搜索等）
 * - 记忆工具源（读写工作记忆）
 * - 事件记录器 + Span 跟踪器
 *
 * 调用方只需通过 toolBroker 追加 agent 专属工具（Skill/RAG 等）。
 */
export function createLoopFor(
  agent: Agent,
  opts?: {
    /** 追加到 ToolBroker 的 agent 专属工具 */
    extraTools?: Tool[];
  },
): AgentLoop {
  const memory = vico.memory;

  const processors: ContextProcessor[] = [
    new SystemPromptProcessor(),
  ];

  const toolBroker = new ToolBroker();

  if (memory) {
    processors.push(new MemoryProcessor(memory));
    // Memory 工具源（updateWorkingMemory）
    const memorySource: ToolSource = {
      name: 'memory',
      list: async () => [createUpdateWorkingMemoryTool(memory.working)],
    };
    toolBroker.addSource(memorySource);
  }

  // agent 专属工具（Skill 工具、RAG 工具等）
  if (opts?.extraTools?.length) {
    toolBroker.addSource({
      name: 'primary',
      list: async () => opts.extraTools!,
    });
  }

  toolBroker.addSource(createBuiltInToolSource());

  return new AgentLoop({
    agent,
    toolBroker,
    processors,
    events: vico.events,
    spanTracker: vico.spanTracker,
  });
}

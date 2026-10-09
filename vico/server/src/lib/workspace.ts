/**
 * 线程工作目录解析 — 供文件系统 API 与终端共享。
 *
 * 工作目录解析优先级：
 * 1. thread.metadata.workspace（通过 chdir 设置，持久化到 ThreadStore）
 * 2. agent.workspace（从 AgentConfig 取得）
 * 3. 空（返回空列表）
 */
import { getAgent } from '../agent/get-agent.js';
import { vico } from '../vico.js';

/**
 * 获取线程当前的工作目录。
 *
 * 优先返回 thread.metadata.workspace；未绑定时回退到 agent.workspace；
 * 若 agent 也无 workspace 则返回空字符串。
 */
export async function getThreadWorkspace(threadId: string): Promise<string> {
  const store = vico.thread;
  if (!store) return '';

  const thread = await store.getThread(threadId);
  const bound = thread?.metadata?.workspace as string | undefined;
  if (bound) return bound;

  if (thread?.agentId) {
    const agent = await getAgent(thread.agentId);
    if (agent?.workspace) return agent.workspace;
  }

  return '';
}

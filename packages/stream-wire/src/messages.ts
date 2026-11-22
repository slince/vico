/**
 * 线上消息 → 引擎入参 `ModelMessage[]`。
 *
 * 前端下发的就是 `AgentMessage`（原生 ModelMessage + id），因此这里不做结构改写，
 * 只做两件事：
 * - 审批续跑：`resume` 转为 `tool-approval-response` part（引擎按它恢复暂停的 turn）
 * - 缺省线程：由路由层处理（见 api/chat.ts），与本模块无关
 *
 * 保留 `id` 是有意的：引擎 `startTurn` 会沿用它作为持久化 id，
 * 前端渲染的消息与刷新后从历史拿到的消息因此是同一个标识。
 */
import type {ModelMessage} from '@vico/model';
import {SESSION_SCOPE_REASON} from '@vico/tool';
import type {AgentMessage} from '@vico/model';
import type {VicoApprovalResume} from './types.js';

/**
 * 前端消息原样作为引擎入参（`AgentMessage` 是 `ModelMessage` 的子类型）。
 *
 * @param messages - 请求体里的 messages
 * @returns 引擎入参
 */
export function vicoMessagesToModelMessages(messages: readonly AgentMessage[]): ModelMessage[] {
  return [...messages] as ModelMessage[];
}

/**
 * 审批决议 → `tool-approval-response` part（单条 tool 消息承载）。
 *
 * scope='session' 经 `SESSION_SCOPE_REASON` 标记，引擎据此把决议升级为会话级授权。
 *
 * @param resume - 审批决议
 * @returns 单条 tool 角色的 ModelMessage
 */
export function resumeToModelMessages(resume: readonly VicoApprovalResume[]): ModelMessage[] {
  const parts = resume.map((entry) => {
    const reason = entry.scope === 'session' ? SESSION_SCOPE_REASON : entry.reason;
    return {
      type: 'tool-approval-response' as const,
      approvalId: entry.approvalId,
      approved: entry.approved,
      ...(reason != null ? {reason} : {}),
    };
  });
  return [{role: 'tool', content: parts} as ModelMessage];
}

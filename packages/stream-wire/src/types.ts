/**
 * vico 前后端线上协议（wire）的公共类型。
 *
 * 只有两样东西穿过网络，都不是新发明的格式：
 * - 消息：`AgentMessage`（原生 ModelMessage + 引擎 id）
 * - 流：引擎的 `ChunkType`
 * 这里定义的只是请求信封（线程/run/运行配置/审批决议），刻意与消息内容解耦。
 */
import type {AgentMessage} from '@vico/model';

/** 一次 run 的运行配置（由前端各选择器经 modelContext 合并得到） */
export interface VicoRunConfig {
  agentId?: string;
  modelName?: string;
  reasoningEffort?: string;
  approvalMode?: string;
  workspace?: string;
}

/** 审批决议：恢复暂停的 turn 时回传 */
export interface VicoApprovalResume {
  /** 与 toolCallId 相同的审批 ID（引擎约定） */
  approvalId: string;
  approved: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/** `POST /api/v1/chat` 请求体 */
export interface VicoRunRequest {
  /** 目标线程；缺省时由服务端新建（ID 经响应头 `x-thread-id` 回传） */
  threadId?: string;
  runId: string;
  /** 本轮输入消息；审批续跑时可为空数组 */
  messages: AgentMessage[];
  config?: VicoRunConfig;
  /** 审批续跑决议 */
  resume?: VicoApprovalResume[];
}

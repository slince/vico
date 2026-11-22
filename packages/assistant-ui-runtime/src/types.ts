/**
 * 包对外类型：传输层协议与 runtime 选项。
 *
 * 设计约束（与产品方约定）：
 * - 流式协议直接复用引擎的 `ChunkType`，不另立事件 schema；
 * - 请求 / 历史消息直接复用 `AgentMessage`（含 id 与 turnId），不另立消息格式；
 * - 线程列表由宿主注入 adapter（web 侧依赖 react-query 失效逻辑与业务 store，不放进本包）。
 */
import type {AgentMessage} from '@vico/model';
import type {ChunkType} from '@vico/stream';
import type {
  AssistantRuntime,
  AttachmentAdapter,
  DictationAdapter,
  RemoteThreadListAdapter,
} from '@assistant-ui/react';

/** 一次 run 的运行配置（透传给后端 forwardedProps） */
export interface VicoRunConfig {
  modelName?: string;
  reasoningEffort?: string;
  approvalMode?: string;
  workspace?: string;
}

/** 审批决议载荷：恢复执行时回传（与后端 resumeToModelMessages 对齐） */
export interface VicoApprovalResume {
  approvalId: string;
  approved: boolean;
  reason?: string;
  scope?: 'turn' | 'session';
}

/** 一次 chat 请求体 */
export interface VicoRunRequest {
  threadId: string;
  runId: string;
  agentId?: string;
  /** 本轮输入消息（默认只发最后一条 user，历史由后端按 threadId 补全） */
  messages: AgentMessage[];
  config?: VicoRunConfig;
  /** 审批恢复决议；仅审批续跑时携带 */
  resume?: VicoApprovalResume[];
}

/** 一次 run 的句柄：线程 ID 在响应头到达时即确定，chunk 流可后续消费 */
export interface VicoRunHandle {
  /** 服务端下发的真实线程 ID（`x-thread-id`）；透传场景可能缺省 */
  threadId?: string;
  /** 本次 run 的 chunk 流（正常结束或被 abort 时迭代结束） */
  chunks: AsyncIterable<ChunkType>;
}

/** 传输层：把「请求 → ChunkType 流」这一层抽象出来，换成 WS/测试桩都不影响上层 */
export interface VicoTransport {
  /**
   * 发起一次 run。请求被拒（非 2xx）时直接抛错，由上层展示。
   *
   * @param request - 请求体
   * @param options.signal - 中断信号（同时用于 fetch 与流读取）
   * @returns 线程 ID 与 chunk 流
   */
  run(request: VicoRunRequest, options: {signal: AbortSignal}): Promise<VicoRunHandle>;

  /** 读取线程历史消息（AgentMessage[]，含 id / turnId / usage） */
  loadMessages(threadId: string): Promise<AgentMessage[]>;
}

/** `useVicoRuntime` 选项 */
export interface VicoRuntimeOptions {
  transport: VicoTransport;
  /** 线程列表适配器（宿主注入） */
  threadList: RemoteThreadListAdapter;
  /** 受控线程 ID（URL 路由用）；undefined 表示新会话草稿 */
  threadId?: string;
  /** 固定 Agent（Agent 详情页测试区）；Chat 路由由宿主通过 modelContext 下发 */
  agentId?: string;
  /** 宿主扩展 adapters（history 与 chatModel 由包内提供） */
  adapters?: {
    dictation?: DictationAdapter;
    attachments?: AttachmentAdapter;
  };
  /**
   * 覆盖默认的线程 ID 解析（默认：作用域 remoteId → `threadListItem.initialize()`）。
   * 宿主若已有 initialize 结果缓存，可注入自己的实现以省掉一次异步往返。
   */
  resolveThreadId?: () => Promise<string | undefined>;
  /** 活动线程的真实 ID 变化回调（新会话 initialize 完成 / 切换会话）；undefined 表示草稿态 */
  onThreadIdChange?: (threadId: string | undefined) => void;
  onError?: (error: Error) => void;
  /** 单次 run 的 step 上限（审批续跑会新增 step，默认 50） */
  maxSteps?: number;
}

export type VicoRuntime = AssistantRuntime;

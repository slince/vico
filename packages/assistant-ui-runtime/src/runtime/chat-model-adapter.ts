/**
 * chatModel 适配器：把 assistant-ui 的一次 run 接到 vico 的 `ChunkType` 流上。
 *
 * 与旧 ag-ui runtime 的差别：不再有 HttpAgent / RunAgentInput / 事件聚合层，
 * 请求体就是 `VicoRunRequest`（messages 为 `AgentMessage[]`），响应体就是 ChunkType 帧，
 * 由 `ChunkAccumulator` 直接累积成 assistant-ui 的消息部件。
 */
import type {
  ChatModelAdapter,
  ChatModelRunOptions,
  ChatModelRunResult,
  ThreadMessage,
} from '@assistant-ui/react';
import type {AgentMessage} from '@vico/model';
import {ChunkAccumulator} from '../accumulator/chunk-accumulator.js';
import {collectApprovalResumes, markApprovalsSent} from '../approval/resume.js';
import type {VicoRunConfig, VicoTransport} from '../types.js';

/** 两次推送快照的最小间隔（毫秒）：更密的帧不会带来额外渲染收益 */
const THROTTLE_MS = 60;

/** 服务端要求必须下发 agentId；缺失时在客户端提前失败，避免一次无意义的请求 */
const MISSING_AGENT_MESSAGE = '未选择 Agent，无法发送消息';
/** 线程 ID 解析失败的提示（与既有交互文案一致） */
const MISSING_THREAD_MESSAGE = '未能创建会话，请确认已选择 Agent 后再发送';

export interface VicoChatModelAdapterOptions {
  transport: VicoTransport;
  /** 发送前解析本线程真实 ID（草稿阶段会触发 initialize） */
  resolveThreadId(): Promise<string | undefined>;
  /** 固定 Agent（Agent 详情页测试区）；Chat 路由由 getConfig 提供 */
  agentId?: string;
  /** 运行时读取合并后的运行配置（agentId / modelName / reasoningEffort / approvalMode / workspace） */
  getConfig?(): Record<string, unknown> | undefined;
  /** 服务端在响应头下发的真实线程 ID（新会话首条消息场景） */
  onThreadId?(threadId: string): void;
  /** 运行失败回调（本地 runtime 不提供 onError 钩子，错误在这里统一上报后再抛出） */
  onError?(error: Error): void;
}

/**
 * 从 ThreadMessage 提取可下发给后端的用户消息。
 *
 * 只取最后一条 user 消息：历史由服务端按 threadId 自行补全，客户端不回传全量消息链。
 *
 * @param messages - 当前线程消息（adapter 入参）
 * @returns 本轮输入消息；无 user 消息时为 undefined
 */
function lastUserMessage(messages: readonly ThreadMessage[]): AgentMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'user') continue;
    const content: Array<{type: 'text'; text: string} | {type: 'image'; image: string}> = [];
    for (const part of message.content) {
      if (part.type === 'text') content.push({type: 'text', text: part.text});
      // 图片以 data URL 直接下发（原生 image part 结构）
      else if (part.type === 'image') content.push({type: 'image', image: part.image});
    }
    return {
      id: message.id,
      role: 'user',
      content: content.length > 0 ? content : [{type: 'text', text: ''}],
    };
  }
  return undefined;
}

/**
 * 从合并后的 modelContext config 里挑出请求需要的字段。
 *
 * @param config - modelContext.config（多个选择器浅合并的结果）
 * @param fallbackAgentId - 未在 config 中提供时的固定 Agent
 * @returns 运行配置
 */
function pickRunConfig(
  config: Record<string, unknown> | undefined,
  fallbackAgentId: string | undefined,
): VicoRunConfig & {agentId?: string} {
  const source = config ?? {};
  const out: VicoRunConfig & {agentId?: string} = {};
  const agentId = typeof source.agentId === 'string' ? source.agentId : fallbackAgentId;
  if (agentId) out.agentId = agentId;
  if (typeof source.modelName === 'string') out.modelName = source.modelName;
  if (typeof source.reasoningEffort === 'string') out.reasoningEffort = source.reasoningEffort;
  if (typeof source.approvalMode === 'string') out.approvalMode = source.approvalMode;
  if (typeof source.workspace === 'string') out.workspace = source.workspace;
  return out;
}

/**
 * 创建 chatModel 适配器。
 *
 * 审批续跑的触发由 assistant-ui 决定（决议写回 + shouldContinue 为真），
 * 本适配器每轮只需检查「头部 assistant 消息里已决议但尚未发送的审批」，拼进 `resume`。
 *
 * @param options - 传输、线程 ID 解析与配置读取
 * @returns 供 `useLocalRuntime` 的 `adapters.chatModel` 使用
 */
export function createVicoChatModelAdapter(options: VicoChatModelAdapterOptions): ChatModelAdapter {
  // 已发送的审批（approvalId 在一段会话内唯一），避免同一决议重复下发
  const sentApprovals = new Set<string>();

  return {
    async *run(runOptions: ChatModelRunOptions): AsyncGenerator<ChatModelRunResult, void> {
      try {
        const threadId = await options.resolveThreadId();
        if (!threadId) throw new Error(MISSING_THREAD_MESSAGE);

        // 正在续跑的 assistant 消息（审批决议写在这条消息的 tool-call part 上）；
        // runOptions.messages 只是它之前的消息链，看不到决议
        const ongoing = runOptions.unstable_getMessage?.();
        const resumes = collectApprovalResumes(
          ongoing ?? runOptions.messages.at(-1),
          sentApprovals,
        );
        const config = pickRunConfig(options.getConfig?.() ?? runOptions.context.config, options.agentId);
        if (!config.agentId) throw new Error(MISSING_AGENT_MESSAGE);

        // 审批续跑：只回传决议，恢复所需的消息由引擎按 checkpoint 自行装配
        const userMessage = resumes.length > 0 ? undefined : lastUserMessage(runOptions.messages);
        if (!userMessage && resumes.length === 0) throw new Error('没有可发送的用户消息');

        const request: Parameters<VicoTransport['run']>[0] = {
          threadId,
          runId: (runOptions.runConfig?.custom?.runId as string | undefined) ?? crypto.randomUUID(),
          messages: userMessage ? [userMessage] : [],
          config,
          ...(resumes.length > 0 && {resume: resumes}),
        };
        if (resumes.length > 0) markApprovalsSent(resumes, sentApprovals);

        const handle = await options.transport.run(request, {signal: runOptions.abortSignal});
        // 新会话首条消息：真实 threadId 由响应头带回来，需立刻通知宿主（否则后续消息可能继续用草稿 ID）
        if (handle.threadId) options.onThreadId?.(handle.threadId);

        const accumulator = new ChunkAccumulator();
        const toResult = (): ChatModelRunResult => {
          const snapshot = accumulator.snapshot();
          return {
            content: snapshot.content,
            status: snapshot.status,
            metadata: {
              steps: snapshot.steps,
              ...(snapshot.turnId !== undefined && {custom: {turnId: snapshot.turnId}}),
            },
          };
        };

        // 先吐一帧运行态，让气泡立即进入 streaming 展示
        yield {content: [], status: {type: 'running'}};

        let lastYield = 0;
        for await (const chunk of handle.chunks) {
          accumulator.push(chunk);
          // 节流推送：终态类 chunk 立即推送，其余按时间窗口合并
          const now = Date.now();
          const isTerminal =
            chunk.type === 'finish' ||
            chunk.type === 'finish-step' ||
            chunk.type === 'error' ||
            chunk.type === 'abort' ||
            chunk.type === 'tool-approval-request';
          if (isTerminal || now - lastYield >= THROTTLE_MS) {
            lastYield = now;
            yield toResult();
          }
        }

        yield toResult();
      } catch (error) {
        options.onError?.(error instanceof Error ? error : new Error(String(error)));
        throw error;
      }
    },
  };
}

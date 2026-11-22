/**
 * ChunkType → assistant-ui 消息快照的累积器。
 *
 * 职责边界：
 * - 只做「协议 → UI 消息部件」的搬运，不含网络、不含线程 ID 解析；
 * - 输出 `ThreadAssistantMessagePart[]` 全量快照（assistant-ui 的 chatModel adapter 每次 yield 全量 content）；
 * - 审批门禁：`tool-approval-request` 挂到对应 tool-call part 的 `approval` 上，turn 收尾时状态保持
 *   `requires-action / tool-calls`，由 assistant-ui 的 `shouldContinue` 判定是否等用户决议。
 */
import type {MessageStatus, ThreadAssistantMessagePart} from '@assistant-ui/react';
import type {ChunkType} from '@vico/stream';
import {parsePartialJsonObject, type ReadonlyJSONObject} from 'assistant-stream/utils';

/** 消息级 step 用量（与 assistant-ui `ThreadStep` 结构一致，避免依赖其未导出的类型） */
export interface StepUsage {
  messageId?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** 审批状态（映射到 ToolCallMessagePart['approval']，只保留 UI 需要的字段） */
interface ApprovalState {
  id: string;
  prompt?: string;
  approved?: boolean;
  reason?: string;
}

interface TextEntry {
  readonly kind: 'text';
  readonly id: string;
  text: string;
  done: boolean;
}

interface ReasoningEntry {
  readonly kind: 'reasoning';
  readonly id: string;
  text: string;
  done: boolean;
}

interface ToolEntry {
  readonly kind: 'tool';
  readonly toolCallId: string;
  toolName: string;
  argsText: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
  approval?: ApprovalState;
}

type Entry = TextEntry | ReasoningEntry | ToolEntry;

/** 一次 run 的累积结果 */
export interface AccumulatorSnapshot {
  content: ThreadAssistantMessagePart[];
  status: MessageStatus;
  steps: StepUsage[];
  turnId?: string;
  /** 本次 run 产生的审批决议（恢复执行时回传给后端） */
  approvals: ApprovalState[];
}

/** 部件渲染状态：流式中 running，块结束后 complete */
function partStatus(done: boolean): {type: 'running'} | {type: 'complete'} {
  return done ? {type: 'complete'} : {type: 'running'};
}

/**
 * 取出对象的字符串键（丢掉 `parsePartialJsonObject` 挂上的 symbol 元数据）。
 *
 * @param source - 解析出的部分 JSON 对象
 * @returns 只含字符串键的普通对象
 */
function pickJsonFields(source: ReadonlyJSONObject): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) out[key] = (source as Record<string, unknown>)[key];
  return out;
}

/**
 * 累积器：`push()` 吃 chunk，`snapshot()` 取当前全量视图。
 *
 * 一个 step（一次模型调用）对应一条 assistant 消息；审批续跑会在同一 turn 内产生多个 step，
 * 因此每条消息只累积本 step 的 chunk —— 由 `resolveStepMessageId()` 给出稳定的消息 id。
 */
export class ChunkAccumulator {
  private entries: Entry[] = [];
  private status: MessageStatus = {type: 'running'};
  private steps: StepUsage[] = [];
  private turnId: string | undefined;
  private stepIndex = 0;

  // 文本/推理按上游 part id 归并：同一 id 的 delta 连续追加到同一个 part
  private readonly textEntries = new Map<string, TextEntry>();
  private readonly reasoningEntries = new Map<string, ReasoningEntry>();
  private readonly toolEntries = new Map<string, ToolEntry>();

  /**
   * 消费一个 chunk。
   *
   * @param chunk - 引擎输出的 ChunkType
   */
  push(chunk: ChunkType): void {
    switch (chunk.type) {
      case 'start':
        this.turnId = chunk.payload.turnId;
        break;

      case 'start-step':
        this.stepIndex = chunk.payload.stepIndex;
        break;

      case 'text-start':
        this.ensureText(chunk.payload.id);
        break;

      case 'text-delta': {
        const entry = this.ensureText(chunk.payload.id);
        entry.text += chunk.payload.text;
        break;
      }

      case 'text-end': {
        const entry = this.ensureText(chunk.payload.id);
        entry.done = true;
        break;
      }

      case 'reasoning-start':
        this.ensureReasoning(chunk.payload.id);
        break;

      case 'reasoning-delta': {
        const entry = this.ensureReasoning(chunk.payload.id);
        entry.text += chunk.payload.text;
        break;
      }

      case 'reasoning-end': {
        const entry = this.ensureReasoning(chunk.payload.id);
        entry.done = true;
        break;
      }

      case 'tool-input-start': {
        const entry = this.ensureTool(chunk.payload.toolCallId, chunk.payload.toolName);
        entry.toolName = chunk.payload.toolName;
        break;
      }

      case 'tool-input-delta': {
        const entry = this.ensureTool(chunk.payload.toolCallId);
        entry.argsText += chunk.payload.delta;
        // 流式期间入参是半截 JSON：能解析出多少就先渲染多少，失败则沿用上一次的解析结果
        const partial = parsePartialJsonObject(entry.argsText);
        // 只保留字符串键：解析器会挂一个 symbol 元数据，原样透传会污染 part.args
        if (partial !== undefined) entry.args = pickJsonFields(partial);
        break;
      }

      case 'tool-input-end':
        break;

      case 'tool-call': {
        // provider 也可能只发汇总的 tool-call（不发 tool-input-*），两者都要能落到同一个 part
        const entry = this.ensureTool(chunk.payload.toolCallId, chunk.payload.toolName);
        entry.toolName = chunk.payload.toolName;
        const input = chunk.payload.input;
        if (input !== undefined && input !== null) {
          entry.args = input as Record<string, unknown>;
          entry.argsText = JSON.stringify(input);
        }
        break;
      }

      case 'tool-result': {
        const entry = this.ensureTool(chunk.payload.toolCallId, chunk.payload.toolName);
        entry.result = chunk.payload.output;
        break;
      }

      case 'tool-error': {
        const entry = this.ensureTool(chunk.payload.toolCallId, chunk.payload.toolName);
        entry.result = chunk.payload.error;
        entry.isError = true;
        break;
      }

      case 'tool-output-denied': {
        const entry = this.ensureTool(chunk.payload.toolCallId, chunk.payload.toolName);
        entry.result = 'Tool execution denied';
        entry.isError = true;
        break;
      }

      case 'tool-approval-request': {
        const {approvalId, toolCall} = chunk.payload;
        const entry = this.ensureTool(toolCall.toolCallId, toolCall.toolName);
        entry.toolName = toolCall.toolName;
        if (toolCall.input !== undefined && toolCall.input !== null) {
          entry.args = toolCall.input as Record<string, unknown>;
          if (entry.argsText === '') entry.argsText = JSON.stringify(toolCall.input);
        }
        entry.approval = {id: approvalId, prompt: `Approve tool "${toolCall.toolName}"?`};
        break;
      }

      case 'tool-approval-response': {
        // 恢复执行时回放的决议：把它记在对应 part 上，避免 UI 再把同一张审批卡渲染成待决议
        const entry = this.toolEntries.get(chunk.payload.toolCall.toolCallId);
        if (entry) {
          entry.approval = {
            id: chunk.payload.approvalId,
            ...(entry.approval?.prompt !== undefined && {prompt: entry.approval.prompt}),
            approved: chunk.payload.approved,
            ...(chunk.payload.reason !== undefined && {reason: chunk.payload.reason}),
          };
        }
        break;
      }

      case 'finish-step': {
        this.steps = [
          ...this.steps,
          {
            ...(this.turnId !== undefined && {messageId: this.turnId}),
            usage: {
              inputTokens: chunk.payload.usage.inputTokens.total ?? 0,
              outputTokens: chunk.payload.usage.outputTokens.total ?? 0,
            },
          },
        ];
        break;
      }

      case 'finish': {
        // 有未决议的审批 → 停在 requires-action；否则本轮正常结束
        this.status = this.hasPendingApproval()
          ? {type: 'requires-action', reason: 'tool-calls'}
          : {type: 'complete', reason: 'stop'};
        break;
      }

      case 'error':
        this.status = {type: 'incomplete', reason: 'error', error: chunk.payload.error};
        break;

      case 'abort':
        this.status = {type: 'incomplete', reason: 'cancelled'};
        break;

      default:
        // file / reasoning-file / source / custom / raw / data-* 当前 UI 无对应渲染，直接忽略
        break;
    }
  }

  /** 取当前全量快照（供 chatModel adapter yield） */
  snapshot(): AccumulatorSnapshot {
    return {
      content: this.entries.map((entry) => this.toPart(entry)),
      status: this.status,
      steps: this.steps,
      ...(this.turnId !== undefined && {turnId: this.turnId}),
      approvals: this.collectApprovals(),
    };
  }

  /** 本次 run 里已出现、尚未决议的审批数（用于判定 requires-action） */
  private hasPendingApproval(): boolean {
    return this.collectApprovals().some((approval) => approval.approved === undefined);
  }

  private collectApprovals(): ApprovalState[] {
    const approvals: ApprovalState[] = [];
    for (const entry of this.entries) {
      if (entry.kind === 'tool' && entry.approval) approvals.push(entry.approval);
    }
    return approvals;
  }

  private ensureText(id: string): TextEntry {
    const existing = this.textEntries.get(id);
    if (existing) return existing;
    const entry: TextEntry = {kind: 'text', id, text: '', done: false};
    this.textEntries.set(id, entry);
    this.entries.push(entry);
    return entry;
  }

  private ensureReasoning(id: string): ReasoningEntry {
    const existing = this.reasoningEntries.get(id);
    if (existing) return existing;
    const entry: ReasoningEntry = {kind: 'reasoning', id, text: '', done: false};
    this.reasoningEntries.set(id, entry);
    this.entries.push(entry);
    return entry;
  }

  private ensureTool(toolCallId: string, toolName?: string): ToolEntry {
    const existing = this.toolEntries.get(toolCallId);
    if (existing) return existing;
    const entry: ToolEntry = {
      kind: 'tool',
      toolCallId,
      toolName: toolName ?? '',
      argsText: '',
      args: {},
    };
    this.toolEntries.set(toolCallId, entry);
    this.entries.push(entry);
    return entry;
  }

  private toPart(entry: Entry): ThreadAssistantMessagePart {
    if (entry.kind === 'text') {
      return {type: 'text', id: entry.id, text: entry.text, status: partStatus(entry.done)};
    }
    if (entry.kind === 'reasoning') {
      return {type: 'reasoning', id: entry.id, text: entry.text, status: partStatus(entry.done)};
    }

    const args = entry.args as unknown as ReadonlyJSONObject;
    return {
      type: 'tool-call',
      toolCallId: entry.toolCallId,
      toolName: entry.toolName,
      argsText: entry.argsText,
      args,
      ...(entry.result !== undefined && {result: entry.result}),
      ...(entry.isError !== undefined && {isError: entry.isError}),
      ...(entry.approval !== undefined && {
        approval: {
          id: entry.approval.id,
          ...(entry.approval.prompt !== undefined && {prompt: entry.approval.prompt}),
          ...(entry.approval.approved !== undefined && {approved: entry.approval.approved}),
          ...(entry.approval.reason !== undefined && {reason: entry.approval.reason}),
        },
      }),
    };
  }
}

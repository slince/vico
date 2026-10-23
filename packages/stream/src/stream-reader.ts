// @vico/stream - ModelStreamReader: 消费 provider 原生 V4 流，转换为引擎层 TextStreamPart；结果累积交由 BufferedModelStream
import type {TextStreamPart, ToolSet} from 'ai';

import type {ToolCall} from '@vico/tool';
import type {TurnEvent} from './types.js';
import {createToolCall, finishStepPart, startStepPart, v4FilePart, v4ToolResultPart,} from './stream-parts.js';
import type {CallModelResult, ModelRequest, ModelStreamResult} from '@vico/model';

/** ModelStreamReader 构造选项 */
export interface ModelStreamReaderOptions<TToolSet extends ToolSet = ToolSet> {
  /** 引擎层输出流控制器，接收转换后的 TextStreamPart */
  controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  /** 事件发射回调（转发给事件系统） */
  emit: (event: TurnEvent) => void;
  /** 本 step 输入消息（供 start-step part 携带 request） */
  request: ModelRequest;
}

/**
 * ModelStreamReader — 消费 provider 原生 V4 流，逐 chunk 转换为引擎层 TextStreamPart
 * 并 enqueue 到 controller，同时累积 text / reasoning / toolCalls / usage 及错误信息。
 *
 * 从 LoopAgent.callModel 中抽出，使 V4 → 引擎层协议的映射逻辑独立成类，
 * callModel 仅负责组装请求、获取流，并将流交给 Reader 解析。
 */
export class ModelStreamReader<TToolSet extends ToolSet = ToolSet> {
  private readonly controller: ReadableStreamDefaultController<TextStreamPart<TToolSet>>;
  private readonly emit: (event: TurnEvent) => void;
  private readonly request: ModelRequest;

  constructor(options: ModelStreamReaderOptions<TToolSet>) {
    this.controller = options.controller;
    this.emit = options.emit;
    this.request = options.request;
  }

  /**
   * 消费包装流做 V4 → 引擎层协议转换；结果累积交由 BufferedModelStream 完成后读取。
   *
   * @param result - ModelClient.stream() 返回的流 + 缓冲结果结合体
   * @returns 完整文本 / 推理 / 工具调用 / usage（流内出错时带 error），由 BufferedModelStream.result() 产出
   */
  async read(result: ModelStreamResult): Promise<CallModelResult> {
    const stream = result.stream;

    // ── V4 → TextStreamPart 转换所需的 step 级状态 ──
    const stepStartTime = Date.now();
    /** 首个输出 chunk 到达时间（性能指标 timeToFirstOutputMs） */
    let firstChunkTime: number | undefined;
    /** start-step 是否已发出（stream-start 携带 warnings；未收到时由首个内容 part 兜底触发） */
    let stepStarted = false;
    /** controller 是否已关闭（客户端断开）→ 终止当前 step 的流式输出 */
    let controllerClosed = false;
    /** 从 V4 response-metadata 捕获，进 finish-step.response */
    let responseMeta: { id?: string; modelId?: string; timestamp?: Date } = {};
    /** toolCallId → ToolCall，供 provider 端 tool-result / tool-approval-request 关联 input */
    const callsById = new Map<string, ToolCall>();

    const ensureStepStarted = (warnings: Parameters<typeof startStepPart>[1] = []) => {
      if (stepStarted || controllerClosed) return;
      stepStarted = true;
      try {
        this.controller.enqueue(startStepPart(this.request.messages, warnings));
      } catch {
        controllerClosed = true;
      }
    };

    const reader = stream.getReader();

    /** controller 关闭后仍需读完底层流，驱动 BufferedModelStream 完成累积，避免 result() 悬挂 */
    const drainRemaining = async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // 底层流异常已由 BufferedModelStream 承接（reject completionPromise），此处仅吞掉读取异常
      }
    };

    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;

      // stream-start 携带 warnings → start-step；其余 part 到达前兜底补发 start-step
      if (chunk.type === 'stream-start') {
        ensureStepStarted(chunk.warnings);
        if (controllerClosed) {
          await drainRemaining();
          break;
        }
        continue;
      }
      ensureStepStarted();
      if (controllerClosed) {
        await drainRemaining();
        break;
      }

      switch (chunk.type) {
          // ── 同形透传（重建对象以对齐引擎层类型）──
          case 'text-start':
          case 'text-end':
          case 'reasoning-start':
          case 'reasoning-end':
            this.controller.enqueue(chunk);
            break;

          // ── 文本/推理 delta：V4 的 delta 字段 → TextStreamPart 的 text 字段 ──
          case 'text-delta':
            firstChunkTime ??= Date.now();
            this.controller.enqueue({ type: 'text-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
            this.emit({ type: 'text-delta', content: chunk.delta });
            break;

          case 'reasoning-delta':
            firstChunkTime ??= Date.now();
            this.controller.enqueue({ type: 'reasoning-delta', id: chunk.id, text: chunk.delta, providerMetadata: chunk.providerMetadata });
            this.emit({ type: 'reasoning-delta', content: chunk.delta });
            break;

          // ── 工具输入流式（同形透传）──
          case 'tool-input-start':
          case 'tool-input-delta':
          case 'tool-input-end':
            this.controller.enqueue(chunk);
            break;

          case 'tool-call': {
            // V4 tool-call 的 input 为 JSON 字符串，解析失败时兜底空对象并以 invalid 标记
            let args: Record<string, unknown>;
            let invalid = false;
            let parseError: unknown;
            try {
              args = chunk.input ? JSON.parse(chunk.input) as Record<string, unknown> : {};
            } catch (e) {
              args = {};
              invalid = true;
              parseError = e;
            }
            const call: ToolCall = { id: chunk.toolCallId, name: chunk.toolName, args };
            callsById.set(call.id, call);
            this.controller.enqueue(createToolCall(call, { providerExecuted: chunk.providerExecuted, invalid, error: parseError }));
            this.emit({ type: 'tool-call-start', id: chunk.toolCallId, name: chunk.toolName, args });
            break;
          }

          // ── provider 端执行的工具结果：isError 分流 tool-result / tool-error ──
          case 'tool-result':
            this.controller.enqueue(v4ToolResultPart(chunk, callsById.get(chunk.toolCallId)?.args));
            break;

          // ── provider 端审批请求：关联已记录的 toolCall（查不到则合成占位调用）──
          case 'tool-approval-request': {
            const call = callsById.get(chunk.toolCallId) ?? { id: chunk.toolCallId, name: 'unknown', args: {} };
            this.controller.enqueue({ type: 'tool-approval-request', approvalId: chunk.approvalId, toolCall: createToolCall(call, { providerExecuted: true }) });
            break;
          }

          // ── 文件：V4 data/url 变体 → GeneratedFile ──
          case 'file':
          case 'reasoning-file':
            this.controller.enqueue(v4FilePart(chunk));
            break;

          // ── 同形透传：Source = LanguageModelV4Source ──
          case 'source':
          case 'custom':
          case 'raw':
            this.controller.enqueue(chunk);
            break;

          // ── 响应元数据：捕获进 finish-step.response ──
          case 'response-metadata':
            responseMeta = { id: chunk.id, modelId: chunk.modelId, timestamp: chunk.timestamp };
            break;

          // ── V4 finish（单次调用级）→ finish-step（携带 response/usage/performance）──
          case 'finish':
            this.controller.enqueue(finishStepPart({
              usage: chunk.usage,
              finishReason: chunk.finishReason,
              providerMetadata: chunk.providerMetadata,
              response: responseMeta,
              startTime: stepStartTime,
              firstChunkTime,
            }));
            break;

          case 'error': {
            const err = chunk.error instanceof Error ? chunk.error : String(chunk.error);
            this.emit({ type: 'error', error: err });
            this.controller.enqueue({ type: 'error', error: err });
            break;
          }
      }
    }

    // 文本 / 推理 / 工具调用 / usage / 错误由 BufferedModelStream 累积，此处直接取结果
    return result.result();
  }
}

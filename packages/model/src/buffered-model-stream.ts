// @vico/model - BufferedModelStream：将 provider 原生流包装为「流 + 文本/推理/工具调用 promise」结合体

import type {ToolCall} from '@vico/tool';
import type {ModelStreamPart, ModelStreamResult, ModelToolCall} from './types.js';

/**
 * ModelStreamResult 的实现：包装 provider 原生流，text-delta / reasoning-delta /
 * tool-call 在流经时同步累积进各自缓冲，流读完 resolve 完成信号。无论 stream 由
 * 调用方消费（转发），还是 text()/reasoning()/toolCalls() 主动消费，都能拿到完整
 * 内容；stream 被读取完毕后这些方法不会因流已消费而报错。
 */
export class BufferedModelStream implements ModelStreamResult {
  /** 对外暴露的可读流；读取时同步收集 text / reasoning / tool-call 进缓冲 */
  readonly stream: ReadableStream<ModelStreamPart>;

  /** 流消费完毕信号：自然读完 resolve、取消/出错 reject */
  private readonly completionPromise: Promise<void>;

  /** 已累积的 text-delta 文本缓冲 */
  private textBuffer = '';

  /** 已累积的 reasoning-delta 推理内容缓冲 */
  private reasoningBuffer = '';

  /** 已收集的工具调用（tool-call part 解析） */
  private collectedToolCalls: ToolCall[] = [];

  /** 标记流是否被取消消费（取消时不 resolve，交由 cancel 回调 reject） */
  private cancelled = false;

  private resolveCompletion!: () => void;
  private rejectCompletion!: (reason: unknown) => void;

  /**
   * @param rawStream - provider doStream() 返回的原生 V4 流
   */
  constructor(rawStream: ReadableStream<ModelStreamPart>) {
    this.completionPromise = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });

    const rawReader = rawStream.getReader();

    this.stream = new ReadableStream<ModelStreamPart>({
      pull: async (controller) => {
        try {
          const { done, value: part } = await rawReader.read();
          if (done) {
            controller.close();
            // 取消消费时不 resolve（由 cancel 回调 reject 承接）
            if (!this.cancelled) this.resolveCompletion();
            return;
          }
          if (part.type === 'text-delta') {
            this.textBuffer += part.delta;
          } else if (part.type === 'reasoning-delta') {
            this.reasoningBuffer += part.delta;
          } else if (part.type === 'tool-call') {
            this.collectedToolCalls.push(this.parseToolCall(part));
          }
          controller.enqueue(part);
        } catch (err) {
          controller.error(err);
          this.rejectCompletion(err instanceof Error ? err : new Error(String(err)));
        }
      },
      cancel: (reason) => {
        this.cancelled = true;
        rawReader.cancel(reason).catch(() => {});
        this.rejectCompletion(reason instanceof Error ? reason : new Error(String(reason)));
      },
    });
  }

  /**
   * 完整文本输出（text-delta 拼接）。
   * stream 尚未被消费时主动消费一次以驱动收集；已被消费则等待其读完。
   */
  async text(): Promise<string> {
    await this.ensureConsumed();
    await this.completionPromise;
    return this.textBuffer;
  }

  /**
   * 完整推理内容（reasoning-delta 拼接）。语义同 text()。
   */
  async reasoning(): Promise<string> {
    await this.ensureConsumed();
    await this.completionPromise;
    return this.reasoningBuffer;
  }

  /**
   * 模型生成的工具调用列表（tool-call part 的 args 已 JSON 解析）。语义同 text()。
   */
  async toolCalls(): Promise<ToolCall[]> {
    await this.ensureConsumed();
    await this.completionPromise;
    return this.collectedToolCalls;
  }

  /** 将 V4 tool-call part 解析为引擎层 ToolCall（input JSON 解析失败兜底空对象） */
  private parseToolCall(part: ModelToolCall): ToolCall {
    let args: Record<string, unknown> = {};
    if (part.input) {
      try {
        args = JSON.parse(part.input) as Record<string, unknown>;
      } catch {
        // 非法 JSON 兜底空对象，调用方自行判断
      }
    }
    return { id: part.toolCallId, name: part.toolName, args };
  }

  /** 若流尚未被任何 reader 消费，则主动消费一次以驱动收集 */
  private async ensureConsumed(): Promise<void> {
    if (this.stream.locked) return;
    try {
      const reader = this.stream.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    } catch {
      // 读取错误已由 pull 内 rejectCompletion 承接，此处仅吞掉主动消费的异常
    }
  }
}

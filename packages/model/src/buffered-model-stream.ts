// @vico/model - BufferedModelStream：将 provider 原生流包装为「流 + 完整文本 promise」结合体

import type {LanguageModelV4StreamPart} from '@ai-sdk/provider';
import type {ModelStreamResult} from './types.js';

/**
 * ModelStreamResult 的实现：包装 provider 原生流，text-delta 在流经时同步累积进缓冲，
 * 流读完 resolve text promise。无论 stream 由调用方消费（转发），还是 text() 主动消费，
 * text() 都能拿到完整文本；stream 被读取完毕后 text() 不会因流已消费而报错。
 */
export class BufferedModelStream implements ModelStreamResult {
  /** 对外暴露的可读流；读取时同步收集 text-delta 进缓冲 */
  readonly stream: ReadableStream<LanguageModelV4StreamPart>;

  /** 完整文本 promise，在流自然读完时 resolve、取消/出错时 reject */
  private readonly textPromise: Promise<string>;

  /** 已累积的 text-delta 文本缓冲 */
  private textBuffer = '';

  /** 标记流是否被取消消费（取消时不 resolve text，交由 cancel 回调 reject） */
  private cancelled = false;

  private resolveText!: (value: string) => void;
  private rejectText!: (reason: unknown) => void;

  /**
   * @param rawStream - provider doStream() 返回的原生 V4 流
   */
  constructor(rawStream: ReadableStream<LanguageModelV4StreamPart>) {
    this.textPromise = new Promise<string>((resolve, reject) => {
      this.resolveText = resolve;
      this.rejectText = reject;
    });

    const rawReader = rawStream.getReader();

    this.stream = new ReadableStream<LanguageModelV4StreamPart>({
      pull: async (controller) => {
        try {
          const { done, value: part } = await rawReader.read();
          if (done) {
            controller.close();
            // 取消消费时不 resolve（由 cancel 回调 reject 承接）
            if (!this.cancelled) this.resolveText(this.textBuffer);
            return;
          }
          if (part.type === 'text-delta') {
            this.textBuffer += part.delta;
          }
          controller.enqueue(part);
        } catch (err) {
          controller.error(err);
          this.rejectText(err instanceof Error ? err : new Error(String(err)));
        }
      },
      cancel: (reason) => {
        this.cancelled = true;
        rawReader.cancel(reason).catch(() => {});
        this.rejectText(reason instanceof Error ? reason : new Error(String(reason)));
      },
    });
  }

  /**
   * 完整文本输出（text-delta 拼接）。
   * stream 尚未被消费时主动消费一次以驱动收集；已被消费则等待其读完。
   */
  async text(): Promise<string> {
    if (!this.stream.locked) {
      try {
        const reader = this.stream.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch {
        // 读取错误已由 pull 内 rejectText 承接，此处仅吞掉主动消费的异常
      }
    }
    return this.textPromise;
  }
}

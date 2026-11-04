// @vico/stream - ChunkWriter：引擎输出写入器
//
// 封装 ReadableStreamDefaultController，对外只暴露 write（追加单条 chunk）与
// pipe（泵入整条流）两个方法，屏蔽底层 enqueue 的细节。
import type {ChunkType} from './types.js';

export class ChunkWriter {
  /** 底层流控制器（readable 侧入队） */
  private readonly controller: ReadableStreamDefaultController<ChunkType>;

  constructor(controller: ReadableStreamDefaultController<ChunkType>) {
    this.controller = controller;
  }

  /** 追加一条 chunk（controller 已关闭时抛错，由调用方兜底） */
  write(chunk: ChunkType): void {
    this.controller.enqueue(chunk);
  }

  /** 泵入一条 ChunkType 流（逐条 enqueue，已关闭时静默丢弃并继续读流） */
  async pipe(stream: ReadableStream<ChunkType>): Promise<void> {
    await stream.pipeTo(new WritableStream<ChunkType>({
      write: (chunk) => {
        try {
          this.controller.enqueue(chunk);
        } catch {
          // controller 已关闭（客户端断开）：静默丢弃，仅继续读流
        }
      },
    }));
  }
}

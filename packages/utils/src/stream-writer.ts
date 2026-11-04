// @vico/utils - StreamWriter：ReadableStream 写侧工具
//
// 封装 ReadableStreamDefaultController，对外暴露 write（追加单条数据）与
// forward（灌入整条流）两个方法，屏蔽底层 enqueue 细节。

export class StreamWriter<T> {
  /** 底层流控制器（readable 侧入队） */
  private readonly controller: ReadableStreamDefaultController<T>;

  constructor(controller: ReadableStreamDefaultController<T>) {
    this.controller = controller;
  }

  /** 追加一条数据（controller 已关闭时抛错，由调用方兜底） */
  write(chunk: T): void {
    this.controller.enqueue(chunk);
  }

  /** 把一条流灌入（逐条 enqueue，已关闭时静默丢弃并继续读流） */
  async forward(stream: ReadableStream<T>): Promise<void> {
    await stream.pipeTo(new WritableStream<T>({
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

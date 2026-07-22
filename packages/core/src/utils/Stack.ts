
export class Stack<T> {
  private items: T[] = [];

  // 入栈
  push(item: T): void {
    this.items.push(item);
  }

  // 出栈，空栈返回 undefined
  pop(): T | undefined {
    return this.items.pop();
  }

  // 查看栈顶
  peek(): T | undefined {
    return this.items.at(-1);
  }

  // 是否为空
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  // 栈长度
  size(): number {
    return this.items.length;
  }

  // 清空栈
  clear(): void {
    this.items = [];
  }

  // 获取全部元素（只读副本）
  getItems(): readonly T[] {
    return [...this.items];
  }
}
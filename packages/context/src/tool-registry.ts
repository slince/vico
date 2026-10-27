// @vico/context - ToolRegistry：以工具名为键的工具集合，供处理器增删改查

import type { Tool } from '@vico/tool';

/**
 * 工具注册表 — 以 `tool.name` 为键管理工具集合。
 *
 * 处理器可 {@link get} 取回工具、{@link add} 添加/覆盖工具、
 * {@link delete} 移除工具；{@link list} 还原为 Tool[] 交给模型请求。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /**
   * 添加一个工具；同名工具会被覆盖。
   *
   * @param tool - 待添加的工具
   */
  add(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * 按名称取回工具。
   *
   * @param name - 工具名
   * @returns 对应工具，不存在时返回 undefined
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * 判断工具是否存在。
   *
   * @param name - 工具名
   * @returns 是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 移除一个工具。
   *
   * @param name - 工具名
   * @returns 是否实际移除了工具
   */
  delete(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 清空全部工具。
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * 还原为 Tool[]（按添加顺序，供 toToolSet 使用）。
   *
   * @returns 工具数组
   */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** 当前工具数量 */
  get size(): number {
    return this.tools.size;
  }
}

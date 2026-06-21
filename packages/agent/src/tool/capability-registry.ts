// src/tool/capability-registry.ts
import type { ToolSpec } from './types.js';

/** 按 capability 标签管理工具注册与过滤 */
export class CapabilityRegistry {
  private tools: Map<string, { tool: ToolSpec; capabilities: string[] }> = new Map();

  register(tool: ToolSpec, capabilities: string[] = []): void {
    this.tools.set(tool.name, { tool, capabilities });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 按 allowedNames 白名单 + capabilities 过滤 */
  filter(allowedNames?: string[], requiredCapabilities?: string[]): ToolSpec[] {
    const results: ToolSpec[] = [];
    for (const { tool, capabilities } of this.tools.values()) {
      // 白名单过滤
      if (allowedNames && !allowedNames.includes(tool.name)) continue;
      // capability 过滤
      if (requiredCapabilities && requiredCapabilities.length > 0) {
        const hasAll = requiredCapabilities.every((c) => capabilities.includes(c));
        if (!hasAll) continue;
      }
      results.push(tool);
    }
    return results;
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)?.tool;
  }

  listAll(): ToolSpec[] {
    return Array.from(this.tools.values()).map((e) => e.tool);
  }
}

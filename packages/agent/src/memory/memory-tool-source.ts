// src/memory/memory-tool-source.ts
import type { Tool, ToolSource } from '../tool/types.js';
import { UPDATE_WORKING_MEMORY_TOOL } from './working-memory-tool.js';

/** 创建 Memory 模块的 ToolSource */
export function createMemoryToolSource(): ToolSource {
  return {
    name: 'memory',
    list: async (): Promise<Tool[]> => {
      return [UPDATE_WORKING_MEMORY_TOOL];
    },
  };
}

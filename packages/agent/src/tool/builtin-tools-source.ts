// src/tool/builtin-tools-source.ts
import type {Tool, ToolExecutionContext} from './types.js';
import type {ToolSource} from './types.js';
import {coreBuiltinTools} from './builtin/index.js';

/** 框架内置工具集 */
export function createBuiltInToolSource(): ToolSource {
  return {
    name: 'builtin',
    list: async (_ctx: ToolExecutionContext): Promise<Tool[]> => {
      return coreBuiltinTools;
    },
  };
}

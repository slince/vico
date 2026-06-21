import {createUpdateWorkingMemoryTool} from "./working-memory-tool.js";
import {MemoryStore} from "../memory-store.js";
import {ToolSource} from "../../tool/types.js";


/** 创建 Memory 模块的 ToolSource，注册 updateWorkingMemory 工具 */
export function createMemoryToolSource(memory: MemoryStore): ToolSource {
  return {
    name: 'memory',
    list: async () => [createUpdateWorkingMemoryTool(memory.working)],
  }
}
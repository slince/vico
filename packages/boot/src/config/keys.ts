// @vico/boot - 配置段 schema 映射表（配置段名 → zod schema 类型）

import type {
  agentSchema,
  checkpointSchema,
  memorySchema,
  modelSchema,
  ragSchema,
  skillsSchema,
  toolSchema,
  workspaceSchema,
} from './schemas/index.js';

/**
 * Vico Agent Framework 配置段映射：声明后 `registerConfig` 校验 schema 类型、
 * `getConfig` 按段名推断出 `z.infer` 后的配置类型。
 *
 * 只涵盖 framework 自身能力（packages/ 下各子包）；应用层专属配置（HTTP 服务、
 * 认证、数据库连接、文件存储/上传等）由使用方自行扩展。
 */
export interface VicoConfigKeys {
  agent: typeof agentSchema;
  skills: typeof skillsSchema;
  memory: typeof memorySchema;
  model: typeof modelSchema;
  rag: typeof ragSchema;
  tool: typeof toolSchema;
  workspace: typeof workspaceSchema;
  checkpoint: typeof checkpointSchema;
}

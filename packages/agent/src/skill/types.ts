// @vico/agent - Skill module type definitions

/** Skill 插件元数据 */
export interface Skill {
  /** Skill 名称 */
  name: string;
  /** Skill 描述 */
  description: string;
  /** 系统提示词片段 */
  instructions: string;
  /** 文件系统路径 */
  path: string;
  /** 来源类型 */
  source: 'local' | 'external' | 'managed';
  /** 许可证 */
  license?: string;
  /** 兼容性声明 */
  compatibility?: string;
  /** 是否允许用户直接调用 */
  userInvocable: boolean;
  /** 引用的文档/资源路径列表 */
  references: string[];
  /** 可执行脚本路径列表 */
  scripts: string[];
  /** 静态资源路径列表 */
  assets: string[];
  /** 扩展元数据 */
  metadata?: Record<string, string>;
}

/** Skill 加载器端口 — 批量加载 Skill 插件 */
export interface SkillLoader {
  /** 加载所有 Skill */
  load(): Promise<Skill[]>;
}

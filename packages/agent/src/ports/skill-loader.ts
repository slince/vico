/**
 * Skill 元数据 — 从 SKILL.md YAML frontmatter 解析。
 * 遵循 Agent Skills 规范 (agentskills.io)。
 */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
  metadata?: Record<string, string>;
}

/**
 * 完整 Skill 对象。
 * Skill = 知识注入，不是可执行工具。
 */
export interface Skill {
  name: string;
  description: string;
  /** Markdown 正文 — 注入 LLM 的指令文本 */
  instructions: string;
  /** Skill 目录路径 */
  path: string;
  /** 来源类型 */
  source: 'local' | 'external' | 'managed';
  license?: string;
  compatibility?: string;
  userInvocable: boolean;
  /** references/ 下文件列表 */
  references: string[];
  /** scripts/ 下文件列表 */
  scripts: string[];
  /** assets/ 下文件列表 */
  assets: string[];
  metadata?: Record<string, string>;
}

/**
 * SkillLoader — Skill 发现和加载端口。
 */
export interface SkillLoader {
  /** 扫描指定根目录，发现所有可用 Skill */
  discover(roots: string[]): Promise<Skill[]>;

  /** 加载单个 Skill（含 instructions、references 等） */
  load(skillPath: string): Promise<Skill>;

  /** 刷新缓存（目录变化时重新扫描） */
  refresh(roots: string[]): Promise<void>;
}

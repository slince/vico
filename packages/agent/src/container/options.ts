import {Skill, SkillLoader} from "../skill/types.js";


/** Skill 扫描配置 */
export type SkillSettings = {
  /** Vico 原生 Skill 扫描根目录 */
  skillDirs?: string[];

  skills?: Skill[];

  /** 开启后自动扫描第三方 AI Agent 产品的全局 Skills（Claude、OpenClaw、Hermes、通用 agents） */
  compatible?: boolean;

  /** 自定义 SkillLoader 数组，不传则使用默认 FSSkillLoader */
  loaders?: SkillLoader[];
};

export type SkillOptions = Skill[] | SkillSettings
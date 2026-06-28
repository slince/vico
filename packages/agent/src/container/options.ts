import {Skill, SkillLoader} from "../skill/types.js";
import {TraceAdapter} from "../observable/trace-adapters.js";
import {TraceLevel} from "../observable/loop-tracer.js";


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



/** 自定义 Trace 适配器配置 */
export interface TraceSettings {
  /** 追踪级别，与 createAdaptersFromLevel 组合，不传则不附加默认适配器 */
  level?: TraceLevel;
  /** 自定义适配器，与 level 对应的默认适配器合并 */
  adapters?: TraceAdapter[];
}

export type TraceOptions = TraceLevel | TraceSettings;
// @vico/agent - SkillCatalogProcessor: appends skill catalog to system prompt
import type { ContextProcessor, ModelRequestContext } from '../prompt/context-processor.js';
import { Priority } from '../prompt/context-processor.js';
import type { SkillCatalogEntry } from './types.js';

/** 追加 Skill 目录到系统提示词（HIGH 优先级） */
export class SkillCatalogProcessor implements ContextProcessor {
  readonly name = 'skill-catalog';
  readonly priority = Priority.HIGH;

  constructor(private readonly catalog: SkillCatalogEntry[]) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    if (this.catalog.length === 0) return;
    const skillList = this.catalog
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    ctx.systemPrompt += `\n\n<available_skills>\n${skillList}\n</available_skills>`;
  }
}

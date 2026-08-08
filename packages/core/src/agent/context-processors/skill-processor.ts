// @vico/core - SkillProcessor: appends skill catalog to system prompt
import type {ContextProcessor} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import {Priority} from './context-processor.js';
import type {Skill} from '../../skill/types.js';

/** 追加 Skill 目录到系统提示词（HIGH 优先级） */
export class SkillProcessor implements ContextProcessor {
  readonly name = 'skill-processor';
  readonly priority = Priority.HIGH;

  constructor(private readonly skills: Skill[]) {}

  async process(ctx: ModelRequestContext): Promise<void> {
    if (this.skills.length === 0) return;
    const skillList = this.skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    ctx.systemPrompt += `\n\n<available_skills>\n${skillList}\n</available_skills>`;
  }
}

// @vico/context - SkillProcessor: appends skill catalog to system prompt
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import type {Skill} from '@vico/skill';
import type {Next} from '@vico/utils';

/** 追加 Skill 目录到系统提示词（HIGH 优先级） */
export class SkillProcessor implements ContextProcessor {
  readonly name = 'skill-processor';
  readonly priority = Priority.HIGH;

  constructor(private readonly skills: Skill[]) {}

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    if (this.skills.length > 0) {
      const skillList = this.skills
        .map((s) => `- ${s.name}: ${s.description}`)
        .join('\n');
      ctx.systemPrompt.registerSection('skills', `<available_skills>\n${skillList}\n</available_skills>`);
    }

    await next();
  }
}

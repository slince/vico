// src/skill/tool/skill-execute.ts
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { createTool } from '../../tool/create-tool.js';
import type { ToolExecutionContext } from '../../tool/types.js';
import type { Skill } from '../types.js';

export interface SkillExecuteOptions {
  /** 获取当前可用的 skills 列表 */
  getSkills(): Skill[];
}

/**
 * 创建 skill_execute 工具，用于执行 Skill scripts 目录下的脚本。
 */
export function createSkillExecuteTool(options: SkillExecuteOptions) {
  const params = z.object({
    skillName: z.string().describe('Skill 名称'),
    scriptName: z.string().describe('要执行的脚本文件名（必须在 Skill scripts 列表中）'),
    args: z.string().optional().describe('传递给脚本的命令行参数'),
  });

  const outputSchema = z.object({
    output: z.string(),
    exitCode: z.number().int(),
    error: z.string().optional(),
  });

  async function execute(args: z.infer<typeof params>, ctx: ToolExecutionContext) {
    const skills = options.getSkills();
    const skill = skills.find((s) => s.name === args.skillName);
    if (!skill) {
      return { output: '', exitCode: 1, error: `Skill "${args.skillName}" 未找到` };
    }

    // 验证脚本在 Skill 的 scripts 列表中
    if (!skill.scripts.includes(args.scriptName)) {
      return {
        output: '', exitCode: 1,
        error: `脚本 "${args.scriptName}" 不在 Skill "${args.skillName}" 的 scripts 列表中。可用脚本: ${skill.scripts.join(', ') || '(无)'}`,
      };
    }

    const scriptPath = resolve(skill.path, 'scripts', args.scriptName);
    if (!existsSync(scriptPath)) {
      return { output: '', exitCode: 1, error: `脚本文件不存在: ${scriptPath}` };
    }

    try {
      const cmd = args.args ? `bash "${scriptPath}" ${args.args}` : `bash "${scriptPath}"`;
      const output = execSync(cmd, {
        cwd: ctx.session.workspace,
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 5 * 1024 * 1024,
      });
      return { output: output.slice(-4000), exitCode: 0 };
    } catch (err: any) {
      return {
        output: err.stdout?.slice(-4000) || '',
        exitCode: err.status || 1,
        error: err.stderr?.slice(-2000) || err.message,
      };
    }
  }

  return createTool({
    name: 'skill_execute',
    description:
      '执行 Skill scripts 目录下的脚本。需提供 Skill 名称和脚本文件名（必须在 Skill 声明的 scripts 列表中）。脚本在 workspace 目录中执行。',
    inputSchema: params,
    outputSchema,
    policy: 'on-request',
    kind: 'command',
    tags: ['skill', 'command'],
    execute,
  });
}

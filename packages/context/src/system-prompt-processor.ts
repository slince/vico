// @vico/context - SystemPromptProcessor: injects agent base system prompt
import type {ContextProcessor} from './context-processor.js';
import {Priority} from './context-processor.js';
import type {ModelRequestContext} from './model-request-context.js';
import type {Next} from '@vico/utils';

/** 注入 agent 基础系统提示词，并强化用户原始目标（HIGH 优先级） */
export class SystemPromptProcessor implements ContextProcessor {
  readonly name = 'system-prompt';
  readonly priority = Priority.HIGH - 100;

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    ctx.systemPrompt.registerSection('system', ctx.agent.systemPrompt);

    const workspace = ctx.session?.workspace;

    if (workspace) {
      ctx.systemPrompt.registerSection(
        'workspace',
        [
          `Your current working directory is \`${workspace}\`. All file operations and shell commands run in this directory by default.`,
          // 文件引用规范：仅对「本回复实际 read/write/edit 过的文件」用相对路径 + 反引号标记；
          // 前端据此把命中的路径渲染成可点击链接，未实际操作过的文件名不会被识别为链接。
          `When you mention a file in your reply, reference it by its path relative to the working directory, wrapped in single backticks (e.g. \`src/index.ts\`), and only for files you actually read, wrote, or edited this turn. Do not prepend the full absolute path.`,
        ].join(' '),
      );
    }

    this.registerToolSelection(ctx);

    await next();
  }

  /**
   * 注入工具选择策略 — 引导优先使用专用工具，而非用 bash 原生命令查看/查找文件。
   *
   * 按实际绑定工具条件生成：仅当 bash 与对应专用工具同时存在时才写入规则，
   * 避免对未绑定这些工具的 Agent 造成误导。
   */
  private registerToolSelection(ctx: ModelRequestContext): void {
    const has = (name: string): boolean => ctx.tools.has(name);

    if (!has('bash')) return;

    const rules: string[] = [];
    if (has('read')) rules.push('- To view a file, use `read` (not `bash` with cat/head/tail).');
    if (has('glob')) rules.push('- To find files by name, use `glob` (not `bash` with find/ls).');
    if (has('grep')) rules.push('- To search file contents, use `grep` (not `bash` with grep/rg).');

    if (rules.length === 0) return;

    const readOnly = ['read', 'glob', 'grep'].filter(has).map((n) => `\`${n}\``).join('/');

    const text =
      'Prefer dedicated tools over shell commands when one fits:\n' +
      rules.join('\n') +
      `\nReserve \`bash\` for actions no dedicated tool covers (scripts, builds, tests, git, package managers, etc.). ` +
      `\`bash\` is a mutation tool and may require user approval; ${readOnly} are read-only and run without approval.`;

    ctx.systemPrompt.registerSection('tool-selection', text);
  }
}

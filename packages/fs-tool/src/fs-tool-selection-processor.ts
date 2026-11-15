// @vico/fs-tool - FsToolSelectionProcessor: 文件系统工具选择策略（上下文处理器）
import {Priority, type ContextProcessor, type ModelRequestContext} from '@vico/context';
import type {Next} from '@vico/utils';

/**
 * 文件系统工具选择策略处理器 — 引导优先使用专用工具，而非用 bash 原生命令查看/查找文件。
 *
 * 按实际绑定工具条件生成：仅当 bash 与对应专用工具同时存在时才写入规则，
 * 避免对未绑定这些工具的 Agent 造成误导。
 */
export class FsToolSelectionProcessor implements ContextProcessor {
  readonly name = 'fs-tool-selection';
  readonly priority = Priority.HIGH - 50;

  async handle(ctx: ModelRequestContext, next: Next): Promise<void> {
    if (ctx.tools.has('bash')) {
      const rules: string[] = [];
      if (ctx.tools.has('read')) rules.push('- To view a file, use `read` (not `bash` with cat/head/tail).');
      if (ctx.tools.has('glob')) rules.push('- To find files by name, use `glob` (not `bash` with find/ls).');
      if (ctx.tools.has('grep')) rules.push('- To search file contents, use `grep` (not `bash` with grep/rg).');

      if (rules.length > 0) {
        const readOnly = ['read', 'glob', 'grep'].filter((name) => ctx.tools.has(name)).map((n) => `\`${n}\``).join('/');
        ctx.systemPrompt.registerSection(
          'tool-selection',
          'Prefer dedicated tools over shell commands when one fits:\n' +
            rules.join('\n') +
            `\nReserve \`bash\` for actions no dedicated tool covers (scripts, builds, tests, git, package managers, etc.). ` +
            `\`bash\` is a mutation tool and may require user approval; ${readOnly} are read-only and run without approval.`,
        );
      }
    }

    await next();
  }
}

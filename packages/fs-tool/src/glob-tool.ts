// @vico/fs-tool - glob 查找文件工具
import { relative, resolve } from 'node:path';
import { z } from 'zod';
import { localFilesystem, type Filesystem } from '@vico/fs';
import { createTool, resolveWorkspacePath } from '@vico/tool';
import type { ToolCallContext } from '@vico/tool';

const globParams = z.object({
  pattern: z.string().default('*').describe('匹配文件名的 glob 模式'),
  path: z.string().optional().describe('搜索目录（默认：工作区根目录）'),
  limit: z.number().int().default(200).describe('返回文件的最大数量'),
});

interface GlobResult {
  path: string;
  mtime: number;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

/** 递归收集匹配 glob 的文件，按 mtime 排序前的原始结果 */
async function collectFiles(fs: Filesystem, searchDir: string, regex: RegExp, maxResults: number): Promise<GlobResult[]> {
  const results: GlobResult[] = [];

  async function walk(dir: string) {
    if (results.length >= maxResults) return;
    try {
      const entries = await fs.readDir(dir);
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory) {
          await walk(fullPath);
        } else if (entry.isFile && regex.test(entry.name)) {
          try {
            const stat = await fs.stat(fullPath);
            results.push({ path: fullPath, mtime: stat.mtimeMs });
          } catch {
            results.push({ path: fullPath, mtime: 0 });
          }
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  await walk(searchDir);
  return results;
}

const globOutputSchema = z.object({
  files: z.array(z.string()),
  count: z.number().int(),
});

type GlobOutput = z.infer<typeof globOutputSchema>;

/**
 * 创建 glob 工具 — 通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。
 * @param fs - 文件系统实现，默认本地文件系统
 */
export function createGlobTool(fs: Filesystem = localFilesystem) {
  return createTool({
    name: 'glob',
    description:
      '通过 glob 模式在工作区查找文件，按修改时间排序（最新在前）。用于按命名模式定位文件。',
    inputSchema: globParams,
    outputSchema: globOutputSchema,
    policy: 'auto',
    kind: 'readonly',
    tags: ['requires-workspace'],
    async execute(args: z.infer<typeof globParams>, ctx: ToolCallContext): Promise<GlobOutput> {
      const workspace = ctx.session.workspace!;

      const searchDir = args.path
        ? resolveWorkspacePath(workspace, args.path)
        : resolve(workspace, '.');

      const regex = globToRegex(args.pattern);
      const results = await collectFiles(fs, searchDir, regex, args.limit * 2);

      const sorted = results
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, args.limit)
        .map((r) => relative(workspace, r.path));

      return { files: sorted, count: sorted.length };
    },
  });
}

/** glob 工具默认实例（使用本地文件系统） */
export const globTool = createGlobTool();

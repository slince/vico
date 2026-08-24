/**
 * 包管理工具定义（前端）。
 *
 * 对应服务端 packages/core/src/tool/builtin/coding/package-tools.ts，
 * 参数 schema 与服务端 inputSchema/outputSchema 保持一致。
 * install / run 均为 on-request（需审批）。
 */
import {z} from 'zod/v4';
import type {ToolkitDefinitionEntry} from '@assistant-ui/react';
import {PackageToolRenderer} from './ToolUIs/package-ui';

// ── package_install ──
const packageInstallSchema = z.object({
  packages: z.array(z.string()).optional().describe('要安装的包名列表（不指定则按 lockfile 安装全部依赖）'),
  manager: z.enum(['npm', 'pnpm', 'yarn', 'pip']).optional().describe('包管理器（不指定则自动检测）'),
  dev: z.boolean().optional().describe('是否安装为开发依赖'),
});
const packageInstallOutputSchema = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  manager: z.string(),
  error: z.string().optional(),
});
export type PackageInstallArgs = z.infer<typeof packageInstallSchema>;
export type PackageInstallResult = z.infer<typeof packageInstallOutputSchema>;

// ── package_run ──
const packageRunSchema = z.object({
  script: z.string().describe('要执行的脚本名称（如 test/build/dev）或 pip 命令'),
  manager: z.enum(['npm', 'pnpm', 'yarn', 'pip']).optional().describe('包管理器（不指定则自动检测）'),
});
const packageRunOutputSchema = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  error: z.string().optional(),
});
export type PackageRunArgs = z.infer<typeof packageRunSchema>;
export type PackageRunResult = z.infer<typeof packageRunOutputSchema>;

export const packageInstallTool: ToolkitDefinitionEntry<PackageInstallArgs, PackageInstallResult> = {
  description: '安装依赖包。自动检测包管理器（pnpm/yarn/npm/pip），支持开发依赖安装。不指定 packages 时安装 lockfile 全部依赖。',
  parameters: packageInstallSchema,
  render: PackageToolRenderer,
};

export const packageRunTool: ToolkitDefinitionEntry<PackageRunArgs, PackageRunResult> = {
  description: '执行 package.json scripts 或 pip 命令。自动检测包管理器（pnpm/yarn/npm/pip）。',
  parameters: packageRunSchema,
  render: PackageToolRenderer,
};

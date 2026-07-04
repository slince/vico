// src/tool/builtin/package-tools.ts
import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {z} from 'zod';
import {createTool} from '../../create-tool.js';
import type {ToolCallContext} from '../../types.js';
import {resolveWorkspacePath} from '../workspace.js';

/** 检测项目使用的包管理器 */
function detectPackageManager(cwd: string): string {
  if (existsSync(`${cwd}/pnpm-lock.yaml`)) return 'pnpm';
  if (existsSync(`${cwd}/yarn.lock`)) return 'yarn';
  if (existsSync(`${cwd}/package-lock.json`)) return 'npm';
  if (existsSync(`${cwd}/package.json`)) return 'npm';
  if (existsSync(`${cwd}/requirements.txt`) || existsSync(`${cwd}/pyproject.toml`)) return 'pip';
  return 'npm'; // 默认
}

/** 安全执行命令 */
function runCmd(cwd: string, cmd: string, timeout = 300000): { output: string; exitCode: number; error?: string } {
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf-8', timeout, maxBuffer: 10 * 1024 * 1024 });
    return { output: output.trim(), exitCode: 0 };
  } catch (err: any) {
    return { output: err.stdout?.trim() || '', exitCode: err.status || 1, error: err.stderr?.trim() || err.message };
  }
}

// ── package_install ──

const packageInstallParams = z.object({
  packages: z.array(z.string()).optional().describe('要安装的包名列表（不指定则按 lockfile 安装全部依赖）'),
  manager: z.enum(['npm', 'pnpm', 'yarn', 'pip']).optional().describe('包管理器（不指定则自动检测）'),
  dev: z.boolean().optional().describe('是否安装为开发依赖'),
});

const packageInstallOutput = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  manager: z.string(),
  error: z.string().optional(),
});

async function executePackageInstall(args: z.infer<typeof packageInstallParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');
  const manager = args.manager ?? detectPackageManager(cwd);

  let cmd: string;
  if (args.packages && args.packages.length > 0) {
    const pkgList = args.packages.join(' ');
    switch (manager) {
      case 'pnpm':
        cmd = `pnpm add ${args.dev ? '-D ' : ''}${pkgList}`;
        break;
      case 'yarn':
        cmd = `yarn add ${args.dev ? '--dev ' : ''}${pkgList}`;
        break;
      case 'pip':
        cmd = `pip install ${pkgList}`;
        break;
      default:
        cmd = `npm install ${args.dev ? '--save-dev ' : ''}${pkgList}`;
    }
  } else {
    switch (manager) {
      case 'pnpm': cmd = 'pnpm install'; break;
      case 'yarn': cmd = 'yarn install'; break;
      case 'pip': cmd = 'pip install -r requirements.txt'; break;
      default: cmd = 'npm install';
    }
  }

  const result = runCmd(cwd, cmd);
  return {
    output: result.output.slice(-4000),
    exitCode: result.exitCode,
    manager,
    error: result.error,
  };
}

export const packageInstallTool = createTool({
  name: 'package_install',
  description:
    '安装依赖包。自动检测包管理器（pnpm/yarn/npm/pip），支持开发依赖安装。不指定 packages 时安装 lockfile 全部依赖。',
  inputSchema: packageInstallParams,
  outputSchema: packageInstallOutput,
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'package'],
  execute: executePackageInstall,
});

// ── package_run ──

const packageRunParams = z.object({
  script: z.string().describe('要执行的脚本名称（如 test/build/dev）或 pip 命令'),
  manager: z.enum(['npm', 'pnpm', 'yarn', 'pip']).optional().describe('包管理器（不指定则自动检测）'),
});

const packageRunOutput = z.object({
  output: z.string(),
  exitCode: z.number().int(),
  error: z.string().optional(),
});

async function executePackageRun(args: z.infer<typeof packageRunParams>, ctx: ToolCallContext) {
  const cwd = resolveWorkspacePath(ctx.session.workspace, '.');
  const manager = args.manager ?? detectPackageManager(cwd);

  let cmd: string;
  switch (manager) {
    case 'pnpm': cmd = `pnpm run ${args.script}`; break;
    case 'yarn': cmd = `yarn ${args.script}`; break;
    case 'pip': cmd = `pip ${args.script}`; break;
    default: cmd = `npm run ${args.script}`;
  }

  const result = runCmd(cwd, cmd, 300000);
  return {
    output: result.output.slice(-4000),
    exitCode: result.exitCode,
    error: result.error,
  };
}

export const packageRunTool = createTool({
  name: 'package_run',
  description:
    '执行 package.json scripts 或 pip 命令。自动检测包管理器（pnpm/yarn/npm/pip）。',
  inputSchema: packageRunParams,
  outputSchema: packageRunOutput,
  policy: 'on-request',
  kind: 'command',
  tags: ['builtin', 'package'],
  execute: executePackageRun,
});

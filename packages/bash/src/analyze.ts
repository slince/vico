// @vico/bash - analyzeCommand：将结构化 Command 分析为分类、风险与安全 findings

import os from 'node:os';
import path from 'node:path';

import type { Command } from './command.js';

/**
 * 命令类别：描述一条命令对系统的主要影响面。
 *
 * - `read`：只读（读取文件 / 目录 / 元数据）
 * - `write`：写入（创建 / 修改文件或权限）
 * - `delete`：删除文件或目录
 * - `network`：网络访问
 * - `process`：进程管理
 * - `other`：未归入以上类别的命令
 */
export type CommandCategory = 'read' | 'write' | 'delete' | 'network' | 'process' | 'other';

/**
 * 命令注册表条目：命令名及其类别与风险等级。
 *
 * 风险等级：`delete` / `network` 为 `high`，`write` 为 `low`，其余为 `none`。
 */
export interface CommandDescriptor {
  name: string;
  category: CommandCategory;
  risk: 'none' | 'low' | 'high';
}

/**
 * 分析产物中的单条 finding：供安全策略 / 拦截器消费。
 *
 * - `severity`：严重程度
 * - `code`：稳定的 finding 编码（如 `delete-command`、`path-outside-root`）
 * - `message`：人类可读描述
 * - `segmentIndex`：所属命令段下标
 * - `target`：可选，关联的目标路径（如重定向目标 / 越界路径）
 */
export interface Finding {
  severity: 'info' | 'warning' | 'critical';
  code: string;
  message: string;
  segmentIndex: number;
  target?: string;
}

/**
 * `analyzeCommand` 的返回结构：原命令 + 逐段分析 + findings 列表。
 */
export interface CommandAnalysis {
  command: Command;
  segments: Array<{
    index: number;
    command: string;
    category: CommandCategory;
    risk: 'none' | 'low' | 'high';
    targets: string[];
  }>;
  findings: Finding[];
}

/**
 * 路径策略：命令可触碰的根目录白名单。
 *
 * - `allowRoots`：允许根目录（绝对或相对路径，逐目标与 `path.resolve` 结果比对前缀）
 * - `deny`：预留的拒绝模式（当前任务未启用，后续任务实现）
 */
export interface PathPolicy {
  allowRoots: string[];
  deny?: Array<{ pattern: string | RegExp }>;
}

/**
 * `analyzeCommand` 的可选配置。
 *
 * - `registry`：覆盖内置 {@link COMMAND_REGISTRY} 的注册表
 * - `pathPolicy`：启用路径越界检查（缺省不检查）
 */
export interface AnalyzeOptions {
  registry?: Record<string, CommandDescriptor>;
  pathPolicy?: PathPolicy;
}

/** 命令类别 → 人类可读中文标签 */
const CATEGORY_LABEL: Record<CommandCategory, string> = {
  read: '读取',
  write: '写入',
  delete: '删除',
  network: '网络',
  process: '进程',
  other: '其他',
};

/** 触发 `${category}-command` finding 的类别及其严重程度 */
const CATEGORY_SEVERITY: Partial<Record<CommandCategory, Finding['severity']>> = {
  write: 'warning',
  network: 'warning',
  delete: 'critical',
};

/**
 * 依据类别推导风险等级：`delete` / `network` → `high`，`write` → `low`，其余 → `none`。
 */
function riskForCategory(category: CommandCategory): 'none' | 'low' | 'high' {
  if (category === 'delete' || category === 'network') {
    return 'high';
  }

  if (category === 'write') {
    return 'low';
  }

  return 'none';
}

/**
 * 由「命令名 → 类别」表构建注册表（自动补齐 name / risk 字段）。
 */
function buildRegistry(entries: Record<string, CommandCategory>): Record<string, CommandDescriptor> {
  const registry: Record<string, CommandDescriptor> = {};

  for (const [name, category] of Object.entries(entries)) {
    registry[name] = { name, category, risk: riskForCategory(category) };
  }

  return registry;
}

/**
 * 内置命令注册表（起步表）。
 *
 * 读取类：ls / cat / head / tail / grep / find / wc / pwd / stat / file
 * 写入类：cp / mv / touch / mkdir / tee / chmod / chown / ln
 * 删除类：rm / rmdir
 * 网络类：curl / wget / git / scp / ssh
 * 进程类：ps / kill / top / nohup
 *
 * 未收录的命令由 {@link analyzeCommand} 归为 `other` 并产出 `unknown-command`。
 */
export const COMMAND_REGISTRY: Record<string, CommandDescriptor> = buildRegistry({
  ls: 'read',
  cat: 'read',
  head: 'read',
  tail: 'read',
  grep: 'read',
  find: 'read',
  wc: 'read',
  pwd: 'read',
  stat: 'read',
  file: 'read',

  cp: 'write',
  mv: 'write',
  touch: 'write',
  mkdir: 'write',
  tee: 'write',
  chmod: 'write',
  chown: 'write',
  ln: 'write',

  rm: 'delete',
  rmdir: 'delete',

  curl: 'network',
  wget: 'network',
  git: 'network',
  scp: 'network',
  ssh: 'network',

  ps: 'process',
  kill: 'process',
  top: 'process',
  nohup: 'process',
});

/**
 * 判断 `resolved` 是否位于 `root` 之内（路径分隔符感知，`/app2` 不算 `/app` 内）。
 */
function isInsideRoot(resolved: string, root: string): boolean {
  // 去掉根目录末尾分隔符，便于拼接子路径前缀
  const rootBase = root.replace(/[/\\]+$/, '');

  return resolved === rootBase || resolved.startsWith(rootBase + path.sep);
}

/**
 * 展开目标路径开头的 `~`：`~` → 用户主目录，`~/…` → 主目录下的相对路径，其余原样返回。
 *
 * shell 在执行前会把 `~` 展开为 `$HOME`，路径越界判断须先做同样的展开，
 * 否则 `rm ~/.ssh/id_rsa` 之类的目标会绕过 allowRoots 检查。
 */
function expandTilde(target: string): string {
  if (target === '~') {
    return os.homedir();
  }

  if (target.startsWith('~/')) {
    return path.join(os.homedir(), target.slice(2));
  }

  return target;
}

/**
 * 将结构化 {@link Command} 分析为分类、风险与安全 findings。
 *
 * 逐段执行：命令归类（未注册 → `other` + `unknown-command`）、类别 finding、
 * 命令替换检测、重定向记录，以及（提供 `pathPolicy` 时的）路径越界检查。
 * 路径越界不做文件系统访问，仅用 `path.resolve` 归一化后做前缀比对，
 * 因此 `..` 逃逸与绝对路径越界同判 `path-outside-root`。
 *
 * @param command 待分析的命令（来自 {@link parseCommand}）
 * @param options 可选配置（registry / pathPolicy）
 * @returns 逐段分析结果与 findings 列表
 */
export function analyzeCommand(command: Command, options?: AnalyzeOptions): CommandAnalysis {
  const registry = options?.registry ?? COMMAND_REGISTRY;

  const segments: CommandAnalysis['segments'] = [];
  const findings: Finding[] = [];

  command.segments.forEach((seg, index) => {
    const descriptor = registry[seg.command];
    const category = descriptor?.category ?? 'other';

    segments.push({
      index,
      command: seg.command,
      category,
      risk: descriptor?.risk ?? 'none',
      targets: seg.targets,
    });

    // 未注册命令 → other + unknown-command
    if (!descriptor) {
      findings.push({
        severity: 'info',
        code: 'unknown-command',
        message: `未注册的命令 '${seg.command}'，归为 other 类`,
        segmentIndex: index,
      });
    }

    // 写入 / 删除 / 网络类命令的类别 finding
    const severity = CATEGORY_SEVERITY[category];
    if (severity) {
      findings.push({
        severity,
        code: `${category}-command`,
        message: `命令 '${seg.command}' 属于${CATEGORY_LABEL[category]}类命令`,
        segmentIndex: index,
      });
    }

    // 命令替换：扫描段原始文本中的 $(...) 与反引号
    if (seg.text.includes('$(') || seg.text.includes('`')) {
      findings.push({
        severity: 'warning',
        code: 'command-substitution',
        message: '命令段包含命令替换（$(...) 或反引号）',
        segmentIndex: index,
      });
    }

    // 重定向：解析阶段已把重定向目标排除在 targets 之外
    for (const redirect of seg.redirects) {
      findings.push({
        severity: 'warning',
        code: 'redirection',
        message: `命令段包含重定向（${redirect.operator}）`,
        segmentIndex: index,
        target: redirect.target,
      });
    }

    // 路径策略：目标与重定向目标归一化后与 allowRoots 前缀比对，越界即 critical
    if (options?.pathPolicy) {
      const { allowRoots } = options.pathPolicy;

      // 单个目标：展开 `~` → 归一化 → 前缀比对，越界产出 path-outside-root
      const checkTarget = (target: string) => {
        const resolved = path.resolve(command.cwd ?? '/', expandTilde(target));

        const inside = allowRoots.some((root) => isInsideRoot(resolved, path.resolve(root)));

        if (!inside) {
          findings.push({
            severity: 'critical',
            code: 'path-outside-root',
            message: `目标路径 '${resolved}' 超出允许根目录`,
            segmentIndex: index,
            target,
          });
        }
      };

      for (const target of seg.targets) {
        checkTarget(target);
      }

      for (const redirect of seg.redirects) {
        // 自包含的 fd 复制（2>&1）target 为空，跳过
        if (redirect.target) {
          checkTarget(redirect.target);
        }
      }
    }
  });

  return { command, segments, findings };
}

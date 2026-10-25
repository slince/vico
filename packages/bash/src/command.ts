// @vico/bash - 命令抽象层：Command 结构类型

/**
 * 命令段之间的连接运算符。
 *
 * - `none`：首个命令段（无前置运算符）
 * - `and`：`&&`（前段成功后执行）
 * - `or`：`||`（前段失败后执行）
 * - `semi`：`;`（无条件顺序执行）
 * - `pipe`：`|`（前段输出作为后段输入）
 */
export type CommandOperator = 'none' | 'and' | 'or' | 'semi' | 'pipe';

/**
 * 重定向描述（`>` / `>>` / `<` / `2>` / `2>&1` / `&>` 等）。
 *
 * `parseCommand` 解析阶段识别重定向运算符，运算符与目标分别记录为
 * `operator` / `target`，且均不进 `flags` / `args` / `targets`。
 */
export interface Redirect {
  operator: string;
  target: string;
}

/**
 * 单个命令段：一行命令按运算符拆分后的独立可执行单元。
 *
 * - `command`：首 token（空段时为 `''`）
 * - `flags`：`-` 开头的 token（`-rf` 已拆为 `-r` / `-f`）
 * - `args`：其余非 flag token
 * - `targets`：args 中形如路径者（`/`、`./`、`../`、`~` 开头或含 `/`）
 * - `redirects`：重定向（运算符 + 目标），已从 args / targets 中排除
 */
export interface CommandSegment {
  operator: CommandOperator;
  text: string;
  command: string;
  flags: string[];
  args: string[];
  targets: string[];
  redirects: Redirect[];
}

/**
 * 解析后的一整行命令。
 *
 * - `raw`：原始命令行文本
 * - `segments`：按运算符拆分后的命令段序列（至少 1 段）
 * - `timeout`：执行超时毫秒数（缺省 120000）
 */
export interface Command {
  raw: string;
  segments: CommandSegment[];
  cwd?: string;
  timeout: number;
  env?: Record<string, string>;
}

/**
 * 命令执行结果（后续执行任务产出，解析任务不涉及）。
 */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut?: boolean;
  blocked?: boolean;
  blockReason?: string;
}

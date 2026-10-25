// @vico/bash - parseCommand：将一行 shell 命令解析为结构化 Command

import type {
  Command,
  CommandOperator,
  CommandSegment,
  Redirect,
} from './command.js';

/** 缺省执行超时（毫秒） */
const DEFAULT_TIMEOUT = 120000;

/**
 * parseCommand 的可选配置。
 *
 * - `cwd`：命令执行的工作目录
 * - `timeout`：执行超时毫秒数（缺省 120000）
 * - `env`：附加环境变量
 */
export interface ParseOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * 将一行 shell 命令解析为结构化 {@link Command}。
 *
 * 拆段顺序 `&&` → `||` → `;` → `|`（先长后短，仅顶层）；每段词法化时识别
 * 单/双引号与反斜杠；首 token 为 command，`-` 开头为 flag（`-rf` 拆为
 * `-r`/`-f`，`--x=v` 整体），其余为 arg，路径样 arg 同时进入 targets。
 *
 * @param raw 原始命令行文本
 * @param options 可选配置（cwd / timeout / env）
 * @returns 结构化命令；空白输入退化为单段空 command，不抛异常
 */
export function parseCommand(raw: string, options?: ParseOptions): Command {
  const segments = splitSegments(raw).map((seg) => parseSegment(seg.operator, seg.text));

  return {
    raw,
    segments,
    cwd: options?.cwd,
    timeout: options?.timeout ?? DEFAULT_TIMEOUT,
    env: options?.env,
  };
}

/** 拆段中间结果：运算符 + 该段的原始文本 */
interface RawSegment {
  operator: CommandOperator;
  text: string;
}

/**
 * 按运算符把整行命令拆成段。
 *
 * 单遍扫描，仅识别引号外、未被反斜杠转义的运算符；单引号内反斜杠为字面量。
 * 运算符按「先长后短」匹配，保证 `||` 先于 `|`、`&&` 先于单字符。
 */
function splitSegments(raw: string): RawSegment[] {
  const segments: RawSegment[] = [];
  let start = 0;

  // 即将压入的段所对应的前置运算符（首段为 'none'）
  let pendingOperator: CommandOperator = 'none';

  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    // 引号内不拆分运算符
    if (inSingle || inDouble) {
      continue;
    }

    // 先匹配双字符运算符，再匹配单字符
    if (ch === '&' && raw[i + 1] === '&') {
      segments.push({ operator: pendingOperator, text: raw.slice(start, i) });
      pendingOperator = 'and';
      i++;
      start = i + 1;
      continue;
    }

    if (ch === '|' && raw[i + 1] === '|') {
      segments.push({ operator: pendingOperator, text: raw.slice(start, i) });
      pendingOperator = 'or';
      i++;
      start = i + 1;
      continue;
    }

    if (ch === ';') {
      segments.push({ operator: pendingOperator, text: raw.slice(start, i) });
      pendingOperator = 'semi';
      start = i + 1;
      continue;
    }

    if (ch === '|') {
      segments.push({ operator: pendingOperator, text: raw.slice(start, i) });
      pendingOperator = 'pipe';
      start = i + 1;
      continue;
    }
  }

  segments.push({ operator: pendingOperator, text: raw.slice(start) });

  return segments;
}

/**
 * 把单个段文本解析为 {@link CommandSegment}。
 *
 * 重定向运算符（`>` / `>>` / `<` / `2>` / `2>&1` / `&>` 等，且未加引号/转义）
 * 记入 `redirects`，运算符与其目标 token 均不进 `flags` / `args` / `targets`。
 * 自包含的 fd 复制（`2>&1`）无目标，不吞下一 token。
 */
function parseSegment(operator: CommandOperator, text: string): CommandSegment {
  const tokens = tokenize(text);

  const command = tokens[0]?.value ?? '';
  const rest = tokens.slice(1);

  const flags: string[] = [];
  const args: string[] = [];
  const redirects: Redirect[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];

    if (!token.quoted && isRedirectOperator(token.value)) {
      // 自包含的 fd 复制（2>&1）无目标，不吞下一 token
      if (isFdDuplication(token.value)) {
        redirects.push({ operator: token.value, target: '' });
        continue;
      }

      redirects.push({ operator: token.value, target: rest[i + 1]?.value ?? '' });
      i++;
      continue;
    }

    if (token.value.startsWith('-')) {
      flags.push(...splitFlags(token.value));
    } else {
      args.push(token.value);
    }
  }

  const targets = args.filter(isPathLike);

  return {
    operator,
    text,
    command,
    flags,
    args,
    targets,
    redirects,
  };
}

/** 词法化产物：token 文本 + 是否来自引号/转义 */
interface Token {
  value: string;
  /** 任一字符来自单/双引号或反斜杠转义则为 true */
  quoted: boolean;
}

/**
 * 词法化段文本：识别单/双引号与反斜杠，按顶层空白切分 token。
 *
 * 引号内容去掉引号字面并入 token（引号内空白保留）；反斜杠转义下一字符。
 * 记录每个 token 的 `quoted` 来源，供 {@link parseSegment} 区分「真正的
 * 重定向运算符」与「被引号/转义包裹的字面 `>`」。
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let currentQuoted = false;

  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      current += ch;
      // 转义产生的字符标记为 quoted
      currentQuoted = true;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      // 单引号内反斜杠为字面量，其余情况转义下一字符
      if (inSingle) {
        current += ch;
        currentQuoted = true;
      } else {
        escaped = true;
      }
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      currentQuoted = true;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      currentQuoted = true;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inSingle || inDouble) {
        current += ch;
      } else if (current.length > 0) {
        tokens.push({ value: current, quoted: currentQuoted });
        current = '';
        currentQuoted = false;
      }
      continue;
    }

    current += ch;
  }

  // 末尾孤立反斜杠原样保留
  if (escaped) {
    current += '\\';
    currentQuoted = true;
  }

  if (current.length > 0) {
    tokens.push({ value: current, quoted: currentQuoted });
  }

  return tokens;
}

/**
 * 把 flag token 拆为独立 flag：`--x=v` 整体保留，`-rf` 拆为 `-r` / `-f`。
 */
function splitFlags(token: string): string[] {
  if (token.startsWith('--')) {
    return [token];
  }

  const chars = token.slice(1);
  if (chars.length === 0) {
    // 单独的 '-' 原样保留
    return [token];
  }

  return [...chars].map((ch) => `-${ch}`);
}

/**
 * 判断 token 是否为重定向运算符：
 * `>` / `>>` / `<`，或 `2>` / `2>>` / `2>&1` / `&>` / `&>>` 形式。
 */
function isRedirectOperator(token: string): boolean {
  if (token === '>' || token === '>>' || token === '<') {
    return true;
  }

  // 数字文件描述符重定向 / 合并（2>、2>>、2>&1）与 &> / &>>
  return /^(?:\d+>>?|\d+>&\d+|&>>?)$/.test(token);
}

/**
 * 判断是否为自包含的 fd 复制重定向（`2>&1`、`1>&2`）：无独立目标 token。
 */
function isFdDuplication(token: string): boolean {
  return /^\d+>&\d+$/.test(token);
}

/**
 * 判断 arg 是否形如路径：`/`、`./`、`../`、`~` 开头，或含 `/`。
 */
function isPathLike(token: string): boolean {
  return (
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.startsWith('~') ||
    token.includes('/')
  );
}

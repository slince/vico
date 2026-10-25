# @vico/bash 命令抽象层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `@vico/bash`（解析/分析/策略/Local 执行，零依赖）+ `@vico/bash-ssh`（SSH 执行器），并把 `@vico/bash-tool` 重构为薄壳。

**Architecture:** 端口 + 适配器：`@vico/bash` 定义 `Command`/`CommandExecutor`/`InterceptionPolicy` 端口与 `parseCommand`/`analyzeCommand`/`LocalCommandExecutor` 实现；`@vico/bash-ssh` 提供 `SshCommandExecutor`；`@vico/bash-tool` 只做参数→Command→执行，不改对外导出。

**Tech Stack:** TypeScript ESM（NodeNext）、vitest、`node:child_process`、`ssh2`、zod（仅 bash-tool）。

**Spec:** `docs/superpowers/specs/2026-10-25-bash-command-abstraction-design.md`

## Global Constraints

- ESM：所有相对导入带 `.js` 扩展名；`import type` 用于纯类型。
- 库包 `package.json`：`"exports": { ".": "./src/index.ts" }`、`"type": "module"`，scripts 只有 `typecheck`（`tsc --noEmit`）与 `test`（`vitest run`）。
- `tsconfig.json` 逐字复制 `packages/fs/tsconfig.json`（ES2024 / NodeNext / strict / declaration）。
- `@vico/bash` 零运行时依赖；`@vico/bash-ssh` 依赖 `@vico/bash` + `ssh2`；`@vico/bash-tool` 依赖 `@vico/bash` + `@vico/tool` + `@vico/utils` + `zod`。
- 导出符号需 JSDoc；关键逻辑行加行注释（项目规范）。
- 避免 `any`；`ssh2` 缺类型时用最小 `import type` / 局部声明补。
- `@vico/bash-tool` 对外导出 `bashTool` / `pwshTool` / `shellTools` / `pwshTools` 保持不变；`bash` 工具参数/输出 schema 不变。
- `parseCommand` 默认 `timeout` 为 `120000`（对齐现有 bash 工具默认值）。
- 新建 workspace 包或改动任何 `package.json` 依赖后，先运行 `pnpm install` 再 typecheck/test。

## Review Focus

下面这些输入最可能咬到使用者，各配一条测试钉进对应任务：

1. 引号内的分隔符不得拆分：`echo "a && b"` 应是单段，`args` 含 `a && b`。→ Task 1 测试。
2. `||` 不得被拆成两个 `|`：`a || b` 的第二段 `operator === 'or'`。→ Task 1 测试。
3. `..` / 绝对路径逃逸：即使不做文件系统解析，`rm ../etc`、`rm /etc` 在 `cwd='/app'`、`allowRoots=['/app']` 下都应产出 `path-outside-root`。→ Task 2 测试。
4. 重定向目标不得误判为 `targets`：`ls > /tmp/out` 应产出 `redirection` finding，且 `targets` 为空。→ Task 2 测试。
5. 空/空白命令不得抛异常：`parseCommand('   ')` 返回一个可执行的退化 Command（单段、空 command），不 throw。→ Task 1 测试。

---

### Task 1: `@vico/bash` 脚手架 + 类型 + `parseCommand`

**Files:**
- Create: `packages/bash/package.json`、`packages/bash/tsconfig.json`、`packages/bash/README.md`
- Create: `packages/bash/src/command.ts`、`packages/bash/src/parse.ts`
- Test: `packages/bash/src/parse.test.ts`

**Interfaces:**
- Produces（后续任务依赖）:
  ```ts
  // command.ts
  export type CommandOperator = 'none' | 'and' | 'or' | 'semi' | 'pipe';
  export interface Redirect { operator: string; target: string; }
  export interface CommandSegment {
    operator: CommandOperator; text: string; command: string;
    flags: string[]; args: string[]; targets: string[]; redirects: Redirect[];
  }
  export interface Command {
    raw: string; segments: CommandSegment[]; cwd?: string; timeout: number; env?: Record<string, string>;
  }
  export interface CommandResult {
    stdout: string; stderr: string; exitCode: number | null; durationMs: number;
    timedOut?: boolean; blocked?: boolean; blockReason?: string;
  }
  // parse.ts
  export interface ParseOptions { cwd?: string; timeout?: number; env?: Record<string, string>; }
  export function parseCommand(raw: string, options?: ParseOptions): Command;
  ```

- [ ] **Step 1: 建包脚手架 + 写失败测试**

创建 `packages/bash/package.json`（name `@vico/bash`、`private`、`type: module`、`exports: { ".": "./src/index.ts" }`、scripts `test: vitest run` / `typecheck: tsc --noEmit`、无 dependencies、devDependencies 含 `@types/node`/`typescript`/`vitest` 走 `catalog:`）、`tsconfig.json`（复制 `packages/fs/tsconfig.json`）、`README.md`，以及测试文件 `packages/bash/src/parse.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from './parse.js';

describe('parseCommand', () => {
  it('拆分 && 且无空格 &&ls、合并短 flag、抽取 targets', () => {
    const c = parseCommand('rm -rf /www/xxx &&ls -n');
    expect(c.raw).toBe('rm -rf /www/xxx &&ls -n');
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]).toMatchObject({
      operator: 'none', command: 'rm', flags: ['-r', '-f'],
      args: ['/www/xxx'], targets: ['/www/xxx'],
    });
    expect(c.segments[1]).toMatchObject({
      operator: 'and', command: 'ls', flags: ['-n'], args: [], targets: [],
    });
  });

  it('|| 记为一个 or 而非两个 pipe', () => {
    const c = parseCommand('a || b');
    expect(c.segments.map((s) => s.operator)).toEqual(['none', 'or']);
  });

  it('; 与 | 分别记 semi / pipe', () => {
    expect(parseCommand('a; b').segments[1].operator).toBe('semi');
    expect(parseCommand('a | b').segments[1].operator).toBe('pipe');
  });

  it('引号内分隔符不拆分', () => {
    const c = parseCommand('echo "a && b"');
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].args).toEqual(['a && b']);
  });

  it('--flag=value 整体保留', () => {
    const c = parseCommand('grep --color=auto x');
    expect(c.segments[0].flags).toEqual(['--color=auto']);
  });

  it('透传 cwd/timeout/env，timeout 缺省 120000', () => {
    expect(parseCommand('pwd').timeout).toBe(120000);
    const c = parseCommand('pwd', { cwd: '/tmp', timeout: 5000, env: { A: '1' } });
    expect(c).toMatchObject({ cwd: '/tmp', timeout: 5000, env: { A: '1' } });
  });

  it('空白命令退化为单段空 command，不抛异常', () => {
    const c = parseCommand('   ');
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].command).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm install && pnpm --filter @vico/bash test`
Expected: FAIL（`./parse.js` 模块未找到）

- [ ] **Step 3: 实现 `command.ts` 与 `parse.ts`**

按 Interfaces 签名实现。拆段顺序 `&&`→`||`→`;`→`|`（先长后短，`||` 先于 `|`）；词法化识别单双引号与反斜杠；首 token=command、`-` 开头=flags（`-rf` 拆成 `-r`/`-f`，`--x=v` 整体）、其余=args；args 中以 `/`、`./`、`../`、`~` 开头或含 `/` 者为 targets。`$(...)`/反引号/`>` 仅作为原样 token 保留。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vico/bash test`
Expected: PASS（7 条）

- [ ] **Step 5: Commit**

```bash
git add packages/bash
git commit -m "feat(@vico/bash): parse shell command into structured Command"
```

---

### Task 2: `analyzeCommand` + 命令注册表 + 路径策略

**Files:**
- Create: `packages/bash/src/analyze.ts`
- Test: `packages/bash/src/analyze.test.ts`

**Interfaces:**
- Consumes: `Command`、`CommandSegment`（Task 1）
- Produces:
  ```ts
  export type CommandCategory = 'read' | 'write' | 'delete' | 'network' | 'process' | 'other';
  export interface CommandDescriptor { name: string; category: CommandCategory; risk: 'none' | 'low' | 'high'; }
  export interface Finding { severity: 'info' | 'warning' | 'critical'; code: string; message: string; segmentIndex: number; target?: string; }
  export interface CommandAnalysis {
    command: Command;
    segments: Array<{ index: number; command: string; category: CommandCategory; risk: 'none' | 'low' | 'high'; targets: string[]; }>;
    findings: Finding[];
  }
  export interface PathPolicy { allowRoots: string[]; deny?: Array<{ pattern: string | RegExp }>; }
  export interface AnalyzeOptions { registry?: Record<string, CommandDescriptor>; pathPolicy?: PathPolicy; }
  export const COMMAND_REGISTRY: Record<string, CommandDescriptor>;
  export function analyzeCommand(command: Command, options?: AnalyzeOptions): CommandAnalysis;
  ```

- [ ] **Step 1: 写失败测试** `packages/bash/src/analyze.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from './parse.js';
import { analyzeCommand, COMMAND_REGISTRY } from './analyze.js';

describe('analyzeCommand', () => {
  it('识别 delete 类与目标', () => {
    const a = analyzeCommand(parseCommand('rm -rf /www/xxx && ls -n'));
    expect(a.segments[0]).toMatchObject({ command: 'rm', category: 'delete', risk: 'high', targets: ['/www/xxx'] });
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'delete-command', segmentIndex: 0 }));
  });

  it('路径越界 → path-outside-root（含 .. 与绝对路径，不做文件系统解析）', () => {
    const opts = { pathPolicy: { allowRoots: ['/app'] } };
    for (const raw of ['rm ../etc', 'rm /etc']) {
      const a = analyzeCommand(parseCommand(raw, { cwd: '/app' }), opts);
      expect(a.findings).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'critical' }));
    }
  });

  it('命令替换 → command-substitution', () => {
    const a = analyzeCommand(parseCommand('echo $(whoami)'));
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'command-substitution' }));
  });

  it('重定向 → redirection，且目标不进入 targets', () => {
    const c = parseCommand('ls > /tmp/out');
    expect(c.segments[0].targets).toEqual([]);
    const a = analyzeCommand(c);
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'redirection' }));
  });

  it('未注册命令 → unknown-command', () => {
    const a = analyzeCommand(parseCommand('foobar -x'));
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'unknown-command', severity: 'info' }));
  });

  it('内置注册表：ls=read、curl=network', () => {
    expect(COMMAND_REGISTRY['ls'].category).toBe('read');
    expect(COMMAND_REGISTRY['curl'].category).toBe('network');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vico/bash test`
Expected: FAIL（`./analyze.js` 模块未找到）

- [ ] **Step 3: 实现 `analyzeCommand`**

`COMMAND_REGISTRY` 起步表：`ls/cat/head/tail/grep/find/wc/pwd/stat/file`→read；`cp/mv/touch/mkdir/tee/chmod/chown/ln`→write；`rm/rmdir`→delete；`curl/wget/git/scp/ssh`→network；`ps/kill/top/nohup`→process；其余→other（risk 按 delete/network 为 high、write 为 low、其余 none）。路径越界用 `path.resolve(command.cwd ?? '/', target)` 后与 `allowRoots` 前缀比对；`..` 逃逸与绝对越界同判 `path-outside-root`。重定向从 args 中剥离后记 `redirection`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vico/bash test`
Expected: PASS（Task 1 的 7 条 + 本任务 6 条）

- [ ] **Step 5: Commit**

```bash
git add packages/bash/src/analyze.ts packages/bash/src/analyze.test.ts
git commit -m "feat(@vico/bash): analyze command into structured findings"
```

---

### Task 3: `CommandExecutor` 接口 + `InterceptionPolicy` + `withPolicy`

**Files:**
- Create: `packages/bash/src/executor.ts`、`packages/bash/src/policy.ts`
- Test: `packages/bash/src/policy.test.ts`

**Interfaces:**
- Consumes: `Command`、`CommandResult`（Task 1）；`CommandAnalysis`、`AnalyzeOptions`（Task 2）
- Produces:
  ```ts
  // executor.ts
  export interface CommandExecutor { execute(command: Command): Promise<CommandResult>; }
  // policy.ts
  export interface PolicyDecision { allow: boolean; reason?: string; }
  export interface InterceptionPolicy { evaluate(command: Command, analysis: CommandAnalysis): PolicyDecision | Promise<PolicyDecision>; }
  export const permissivePolicy: InterceptionPolicy;
  export function withPolicy(executor: CommandExecutor, policy: InterceptionPolicy, analyzeOptions?: AnalyzeOptions): CommandExecutor;
  ```

- [ ] **Step 1: 写失败测试** `packages/bash/src/policy.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { parseCommand } from './parse.js';
import { analyzeCommand } from './analyze.js';
import { permissivePolicy, withPolicy } from './policy.js';
import type { Command, CommandResult } from './command.js';
import type { CommandAnalysis } from './analyze.js';

const okResult: CommandResult = { stdout: 'x', stderr: '', exitCode: 0, durationMs: 1 };

describe('withPolicy', () => {
  it('permissivePolicy 放行', async () => {
    const cmd = parseCommand('ls');
    const d = await permissivePolicy.evaluate(cmd, analyzeCommand(cmd));
    expect(d).toEqual({ allow: true });
  });

  it('block 时不调用内层执行器，返回 blocked 结果', async () => {
    const inner = { execute: vi.fn().mockResolvedValue(okResult) };
    const policy = { evaluate: () => ({ allow: false, reason: 'no rm' }) };
    const r = await withPolicy(inner, policy).execute(parseCommand('rm -rf /x'));
    expect(inner.execute).not.toHaveBeenCalled();
    expect(r).toMatchObject({ blocked: true, blockReason: 'no rm', stdout: '', exitCode: null, durationMs: 0 });
    expect(r.stderr).toBe('Blocked by policy: no rm');
  });

  it('allow 时透传内层结果，并把 analysis 交给 policy', async () => {
    const inner = { execute: vi.fn().mockResolvedValue(okResult) };
    let received: CommandAnalysis | undefined;
    const policy = { evaluate: (_cmd: Command, analysis: CommandAnalysis) => { received = analysis; return { allow: true }; } };
    const r = await withPolicy(inner, policy).execute(parseCommand('rm -rf /www/xxx'));
    expect(r).toBe(okResult);
    expect(received?.segments[0].category).toBe('delete');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vico/bash test`
Expected: FAIL（`./policy.js` / `./executor.js` 模块未找到）

- [ ] **Step 3: 实现接口与策略**

`executor.ts` 定义 `CommandExecutor`。`policy.ts` 实现 `permissivePolicy`（`evaluate: () => ({ allow: true })`）与 `withPolicy`：内部先 `analyzeCommand(command, analyzeOptions)`，再 `await policy.evaluate(command, analysis)`；`allow=false` 时返回 `{ stdout:'', stderr:\`Blocked by policy: ${reason ?? 'denied'}\`, exitCode:null, durationMs:0, blocked:true, blockReason:reason }`；否则 `return executor.execute(command)`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vico/bash test`
Expected: PASS（+3 条）

- [ ] **Step 5: Commit**

```bash
git add packages/bash/src/executor.ts packages/bash/src/policy.ts packages/bash/src/policy.test.ts
git commit -m "feat(@vico/bash): add CommandExecutor interface and interception policy"
```

---

### Task 4: `LocalCommandExecutor` + 默认单例

**Files:**
- Create: `packages/bash/src/local-executor.ts`
- Test: `packages/bash/src/local-executor.test.ts`

**Interfaces:**
- Consumes: `CommandExecutor`（Task 3）；`Command`、`CommandResult`（Task 1）
- Produces:
  ```ts
  export interface LocalExecutorOptions {
    command: string;
    args?: (command: string) => string[];
    env?: NodeJS.ProcessEnv;
  }
  export class LocalCommandExecutor implements CommandExecutor {
    constructor(options: LocalExecutorOptions);
    execute(command: Command): Promise<CommandResult>;
  }
  export const localCommandExecutor: CommandExecutor;
  ```

- [ ] **Step 1: 写失败测试** `packages/bash/src/local-executor.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { LocalCommandExecutor } from './local-executor.js';

const bash = new LocalCommandExecutor({ command: '/bin/bash', args: (c) => ['-c', c] });

describe('LocalCommandExecutor', () => {
  it('echo 返回 stdout 与 exitCode 0', async () => {
    const r = await bash.execute({ raw: 'echo hello', segments: [], timeout: 5000 });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe('hello\n');
  });

  it('非零退出码透传', async () => {
    const r = await bash.execute({ raw: 'exit 3', segments: [], timeout: 5000 });
    expect(r.exitCode).toBe(3);
  });

  it('超时返回 exitCode null + timedOut true', async () => {
    const r = await bash.execute({ raw: 'sleep 2', segments: [], timeout: 100 });
    expect(r.exitCode).toBeNull();
    expect(r.timedOut).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @vico/bash test`
Expected: FAIL（`./local-executor.js` 模块未找到）

- [ ] **Step 3: 实现 `LocalCommandExecutor`**

复用现 `bash-tool.ts` 的 `runCommand`：`spawn(options.command, options.args(command.raw), { cwd: command.cwd, timeout: command.timeout, env })`，收集 stdout/stderr，`once(child,'close')` 取 code；用计时器/信号判定 `timedOut`；计算 `durationMs`。`export const localCommandExecutor = new LocalCommandExecutor({ command: '/bin/bash', args: (c) => ['-c', c] })`。

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @vico/bash test`
Expected: PASS（+3 条）

- [ ] **Step 5: Commit**

```bash
git add packages/bash/src/local-executor.ts packages/bash/src/local-executor.test.ts
git commit -m "feat(@vico/bash): add local command executor"
```

---

### Task 5: `@vico/bash` barrel 与整包收口

**Files:**
- Create: `packages/bash/src/index.ts`
- Modify: `packages/bash/README.md`

**Interfaces:**
- Produces: `@vico/bash` 从 `index.ts` 导出 `parseCommand`/`analyzeCommand`/`COMMAND_REGISTRY`/`permissivePolicy`/`withPolicy`/`CommandExecutor`/`LocalCommandExecutor`/`localCommandExecutor` 及全部类型。

- [ ] **Step 1: 写 barrel `index.ts`**，导出上述符号（re-export 各模块）。

- [ ] **Step 2: 跑全包 typecheck + test**

Run: `pnpm --filter @vico/bash typecheck && pnpm --filter @vico/bash test`
Expected: 全绿（7+6+3+3 = 19 条）

- [ ] **Step 3: Commit**

```bash
git add packages/bash/src/index.ts packages/bash/README.md
git commit -m "feat(@vico/bash): export public API from barrel"
```

---

### Task 6: `@vico/bash-ssh` 适配器包

**Files:**
- Create: `packages/bash-ssh/package.json`、`packages/bash-ssh/tsconfig.json`、`packages/bash-ssh/README.md`
- Create: `packages/bash-ssh/src/ssh-executor.ts`、`packages/bash-ssh/src/index.ts`
- Test: `packages/bash-ssh/src/ssh-executor.test.ts`

**Interfaces:**
- Consumes: `CommandExecutor`、`Command`、`CommandResult`（来自 `@vico/bash`）
- Produces:
  ```ts
  export interface SshConnectionOptions {
    host: string; port?: number; username: string;
    password?: string; privateKey?: string | Buffer; passphrase?: string;
  }
  export function buildRemoteCommand(command: Command): string;
  export class SshCommandExecutor implements CommandExecutor {
    constructor(options: SshConnectionOptions);
    execute(command: Command): Promise<CommandResult>;
    dispose(): Promise<void>;
  }
  ```

- [ ] **Step 1: 建包脚手架 + 写失败测试**（只测可纯函数化的序列化，不连真实 SSH）

创建 `packages/bash-ssh/package.json`（name `@vico/bash-ssh`、`private`、`type: module`、`exports: { ".": "./src/index.ts" }`、scripts `test: vitest run` / `typecheck: tsc --noEmit`、dependencies `@vico/bash: workspace:*` + `ssh2`、devDependencies `@types/node`/`typescript`/`vitest`）、`tsconfig.json`（复制 fs）、`README.md`，以及测试文件 `packages/bash-ssh/src/ssh-executor.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { parseCommand } from '@vico/bash';
import { buildRemoteCommand } from './ssh-executor.js';

describe('buildRemoteCommand', () => {
  it('拼接 env + cd + raw', () => {
    const cmd = parseCommand('ls -la', { cwd: '/www', env: { FOO: 'bar' } });
    expect(buildRemoteCommand(cmd)).toBe("export FOO=bar; cd /www && ls -la");
  });
  it('无 cwd/env 时只输出 raw', () => {
    expect(buildRemoteCommand(parseCommand('pwd'))).toBe('pwd');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm install && pnpm --filter @vico/bash-ssh test`
Expected: FAIL（`./ssh-executor.js` 模块未找到）

- [ ] **Step 3: 实现 `buildRemoteCommand` 与 `SshCommandExecutor`**

`buildRemoteCommand`：`[env 每条 export KEY=VALUE; ]` + `cd <cwd> && ` + `command.raw`（无对应项时省略前缀）。`SshCommandExecutor`：构造存 `SshConnectionOptions`；`execute` 惰性建立并复用 `ssh2.Client` 连接，`client.exec(buildRemoteCommand(command))` 收集 stdout/stderr 与退出码，timeout 用定时器关闭 channel；`dispose()` 关闭连接。`ssh2` 无类型处用最小 `import type` 声明。

- [ ] **Step 4: 跑 typecheck + test**

Run: `pnpm --filter @vico/bash-ssh typecheck && pnpm --filter @vico/bash-ssh test`
Expected: 全绿（2 条）

- [ ] **Step 5: Commit**

```bash
git add packages/bash-ssh
git commit -m "feat(@vico/bash-ssh): add ssh command executor"
```

---

### Task 7: `@vico/bash-tool` 重构为薄壳

**Files:**
- Modify: `packages/bash-tool/src/bash-tool.ts`、`packages/bash-tool/src/pwsh-tool.ts`、`packages/bash-tool/src/index.ts`、`packages/bash-tool/package.json`、`packages/bash-tool/README.md`

**Interfaces:**
- Consumes: `CommandExecutor`、`parseCommand`、`LocalCommandExecutor`/`localCommandExecutor`（`@vico/bash`）
- Produces:
  ```ts
  export function createBashTool(options?: { executor?: CommandExecutor }): Tool;
  export function createPwshTool(options?: { executor?: CommandExecutor }): Tool;
  export const bashTool: Tool;
  export const pwshTool: Tool;
  export const shellTools: Tool[];
  export const pwshTools: Tool[];
  ```

- [ ] **Step 1: 重构 `bash-tool.ts`**

`package.json` 增依赖 `@vico/bash: workspace:*`。`bash-tool.ts`：保留 `bashParams`/`bashOutput`（schema 不变）；新增 `createBashTool({ executor = localCommandExecutor } = {})`，其 `execute` 内 `cwd = resolveWorkspacePath(ctx.session.workspace!, '.')`，`dryRun` 仍返回预览，否则 `parseCommand(args.command, { cwd, timeout: args.timeout })` → `executor.execute(cmd)`，并把 `CommandResult` 映射回 `{ stdout, stderr, exitCode }`。删除本文件内的 `runCommand`（已迁入 `@vico/bash`）。`export const bashTool = createBashTool()`。

- [ ] **Step 2: 重构 `pwsh-tool.ts`**

保留 schema；`createPwshTool({ executor = new LocalCommandExecutor({ command: resolvePwshPath(), args: (c) => [...PWSH_ARGS, c] }) } = {})`；`execute` 内 `dryRun` 预览，否则 `executor.execute({ raw: args.command, segments: [], cwd, timeout: args.timeout })`（**不走 POSIX parse/analyze**）。`export const pwshTool = createPwshTool()`。

- [ ] **Step 3: 更新 `index.ts` 与 README**

`index.ts`：改为导出 `createBashTool`/`createPwshTool` 及 `bashTool`/`pwshTool`/`shellTools`/`pwshTools`（`shellTools`/`pwshTools` 语义不变）。README 删除「持久会话（run/poll/write/stop）」的过期描述，改述薄壳职责。

- [ ] **Step 4: typecheck 链验证**

Run: `pnpm install && pnpm --filter @vico/bash-tool typecheck && pnpm --filter @vico/boot typecheck && cd vico/server && npx tsc --noEmit`
Expected: 全绿（导出不变，boot/server 无感）

- [ ] **Step 5: Commit**

```bash
git add packages/bash-tool
git commit -m "refactor(@vico/bash-tool): delegate execution to @vico/bash"
```

---

## 最终验证

```bash
pnpm --filter @vico/bash typecheck
pnpm --filter @vico/bash test
pnpm --filter @vico/bash-ssh typecheck
pnpm --filter @vico/bash-ssh test
pnpm --filter @vico/bash-tool typecheck
pnpm --filter @vico/boot typecheck
cd vico/server && npx tsc --noEmit
```

运行期由用户验证：`pnpm dev` 聊天确认 `bash` 工具仍可用（默认不放策略，行为不变）。

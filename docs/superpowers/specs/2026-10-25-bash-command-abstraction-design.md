# `@vico/bash` 命令抽象层设计 — 解析 / 校验 / 执行（Local + SSH）

## 1. 背景与意图

现状：`@vico/bash-tool` 的 `bashTool` / `pwshTool` 直接 `spawn` shell，命令是裸字符串
（`command: z.string()`），没有任何结构化解析与拦截能力。这带来两个缺口：

- 不知道一条复合命令里**包含哪些操作**：`rm -rf /www/xxx && ls -n` 里有一次删除（`rm`），
  程序无法在事前识别它。
- 无法对**目标路径**做允许/禁止判断：删除的目录 `/www/xxx` 是否在允许根目录内，无从校验。

目标：新增 `@vico/bash` 领域包，把「字符串命令 → 结构化、可拦截的命令对象 → 可插拔执行」
收敛为单一抽象：

- `parseCommand`：shell 感知的结构化拆分，产出分段及每段的 `command` / `flags` / `args` / `targets`。
- `analyzeCommand`：语义/安全分析，产出结构化 `findings`（删除/网络/路径越界/危险构造）。
- `InterceptionPolicy` 接口：**拦不拦截由上游实现决策**，核心包默认放行，不硬编码任何规则。
- `CommandExecutor` 接口 + `LocalCommandExecutor`（本机 bash/pwsh）+ `SshCommandExecutor`（远端 SSH，适配器包）。

## 2. 目标 / 非目标 / 反目标

### 目标

- 命令字符串解析成结构化分段，程序可按**段 / 类别 / 路径**拦截。
- 拦截决策通过 `InterceptionPolicy` 接口交给上游，核心包只产出「发现」，不做「判决」。
- 本地与 SSH 共用同一 `CommandExecutor` 接口与同一策略窄口（`withPolicy`）。

### 非目标（本轮不做）

- 完整 shell 语义：glob 展开、`$var` 展开、`$(...)` / 反引号执行、子 shell `(...)`、
  重定向执行——这些**只识别、标记为 finding**，不解释也不执行。
- 函数式命令 DSL（`sleep(30)` 这类语法）——shell 形式是 `sleep 30`；若将来要做
  「函数 + 参数」的白名单 typed-command，那是另一个层，不与本包混。
- 会话持久化（run / poll / write / stop）——现 `bash-tool/README.md` 声称有但代码没有，
  属历史遗留，本轮不实现，只在重构时顺手修正 README。
- **接入 `@vico/tool` 的 `approvalModeResolver`**——本轮独立并存、不接线。`analyzeCommand`
  产出的 `targets`/`findings` 未来可喂给审批管线，但本轮不碰 `policy-helpers.ts`。
- 远程交互终端（pty / shell channel）——本包只做「一次性命令执行」（exec channel）；
  远程终端属 `@vico/terminal` 的另一个变体，不在本包范围。

### 反目标（即使能跑也算失败）

- 把 `@vico/bash` 做成 bash 替代品或完整语法解析器。
- 在核心包内写死「`rm` 一律禁止」这类具体规则。
- 破坏 `@vico/bash-tool` 现有导出（`bashTool` / `pwshTool` / `shellTools` / `pwshTools`），
  让 boot / agent 无感。

## 3. 约束

- ESM + `.js` 导入扩展名；库包 `exports: "./src/index.ts"`、只有 `typecheck`（无 build），对齐 `@vico/fs`。
- 严格分层：`@vico/bash` **零运行时依赖**（端口 + 解析 + 分析 + 策略 + Local）；
  `@vico/bash-ssh` 依赖 `@vico/bash` + `ssh2`（适配器）；`@vico/bash-tool` 依赖
  `@vico/bash` + `@vico/tool` + `@vico/utils`；`@vico/boot` 继续只 `import { shellTools }`。
- 类型避免 `any`（`ssh2` 若缺类型，用最小 `import type` 或局部声明补上）。
- 函数/导出组件 JSDoc 完备、关键逻辑行注释（项目规范）。

## 4. 核心设计

### 4.1 类型（`command.ts`，@vico/bash）

```ts
/** 分段之间的分隔符；首段固定为 'none' */
export type CommandOperator = 'none' | 'and' | 'or' | 'semi' | 'pipe';

/** 单个重定向（只记录，不执行） */
export interface Redirect {
  operator: string; // '>' | '>>' | '<' | '2>' | '2>&1' …
  target: string;   // 目标文件/描述符
}

/** 解析出的单段命令 */
export interface CommandSegment {
  operator: CommandOperator; // 与上一段之间的分隔符
  text: string;              // 该段原文
  command: string;           // 首命令名（如 'rm'）
  flags: string[];           // '-r' / '-f'（合并短 flag 已拆开）
  args: string[];            // 非 flag、非命令的 token（含路径）
  targets: string[];         // args 里形似路径的子集（供路径规则比对）
  redirects: Redirect[];
}

/** 结构化命令对象 */
export interface Command {
  raw: string;                       // 原始命令串
  segments: CommandSegment[];
  cwd?: string;                      // 执行目录（绝对路径）
  timeout: number;                   // 毫秒
  env?: Record<string, string>;      // 追加/覆盖的环境变量
}
```

### 4.2 解析（`parse.ts`，@vico/bash）

`parseCommand(raw: string, options?: { cwd?: string; timeout?: number; env?: Record<string, string> }): Command`

- **拆段**：在顶层（引号外）按 `&&`、`||`、`;`、`|` 拆分；先识别 `&&`/`||` 再 `;` 再 `|`
  （避免 `||` 被拆成两个 `|`）；换行视作 `;`。支持 `&&ls` 这种无空格写法。
- **词法化**：单/双引号、反斜杠转义感知；`$(...)`、反引号、`>` 重定向**作为原样 token 保留**，
  不在解析阶段解释。
- **段内归类**：首 token = `command`；以 `-` 开头的 token = `flags`（`-rf` 拆成 `-r` `-f`，
  `--flag=value` 整体保留）；其余 = `args`。`args` 中形似路径的（以 `/`、`./`、`../`、`~`
  开头，或包含 `/`）记为 `targets`。
- 解析是**纯结构、无副作用、不抛异常**；解析不了的段退回「整段作为单 command」，仍可执行与报告。
- **本轮只按 POSIX/bash 语义解析**；pwsh 不做 `parseCommand`/`analyzeCommand`（见 §6）。

### 4.3 分析（`analyze.ts`，@vico/bash）

`analyzeCommand(command: Command, options?: AnalyzeOptions): CommandAnalysis`

```ts
export type CommandCategory = 'read' | 'write' | 'delete' | 'network' | 'process' | 'other';

export interface CommandDescriptor {
  name: string;
  category: CommandCategory;
  risk: 'none' | 'low' | 'high';
}

export interface Finding {
  severity: 'info' | 'warning' | 'critical';
  code: string;         // 稳定枚举，如 'delete-command' | 'path-outside-root' | 'command-substitution'
  message: string;      // 人可读、可回给 LLM 的说明
  segmentIndex: number;
  target?: string;
}

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

export interface PathPolicy {
  allowRoots: string[];                            // 允许的绝对根目录
  deny?: Array<{ pattern: string | RegExp }>;      // 拒绝模式
}

export interface AnalyzeOptions {
  registry?: Record<string, CommandDescriptor>;    // 默认内置 COMMAND_REGISTRY
  pathPolicy?: PathPolicy;                         // 缺省时不检查路径
}
```

分析只**产出 finding，不做判决**：

- 按 `registry` 归类命令 → `category` / `risk`，`delete`/`network`/`write` 等高关注类记录 finding。
- 目标路径相对 `command.cwd` resolve 成绝对后与 `pathPolicy.allowRoots` 比对，越界 → `path-outside-root`；
  含 `..` 逃逸或绝对路径越界 → 相应 warning/critical。
- 危险构造：`$(...)`、反引号 → `command-substitution`；`> file` / `>> file` → `redirection`；
  未注册命令 → `unknown-command`（info）。

内置 `COMMAND_REGISTRY` 给出起步表（可扩展）：`ls/cat/head/tail/grep/find/wc/pwd/stat/file`
→ read；`cp/mv/touch/mkdir/tee/chmod/chown/ln` → write；`rm/rmdir` → delete；
`curl/wget/git/scp/ssh` → network；`ps/kill/top/nohup` → process；其余 → other。

### 4.4 策略（`policy.ts`，@vico/bash）

```ts
export interface PolicyDecision {
  allow: boolean;
  reason?: string; // 拦截原因，注入结果
}

export interface InterceptionPolicy {
  evaluate(command: Command, analysis: CommandAnalysis): PolicyDecision | Promise<PolicyDecision>;
}

/** 默认放行一切 */
export const permissivePolicy: InterceptionPolicy = { evaluate: () => ({ allow: true }) };

/** 给执行器包一层策略：block 时不真正执行，返回结构化结果 */
export function withPolicy(executor: CommandExecutor, policy: InterceptionPolicy): CommandExecutor;
```

上游组装方式：`withPolicy(localCommandExecutor, myPolicy)`（`myPolicy` 内先 `analyzeCommand`
再自行判决）。默认路径不放任何策略，行为与现状一致。拦截结果映射见 §6。

### 4.5 执行（`executor.ts` / `local-executor.ts`，@vico/bash）

```ts
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut?: boolean;
  blocked?: boolean;   // 被策略拦截时 true
  blockReason?: string;
}

export interface CommandExecutor {
  execute(command: Command): Promise<CommandResult>;
}
```

**`LocalCommandExecutor`**（复用现 `bash-tool.ts` 的 `runCommand` 逻辑）：

```ts
export interface LocalExecutorOptions {
  command: string;                                  // 启动命令，默认 '/bin/bash'
  args?: (command: string) => string[];             // 默认 (c) => ['-c', c]
  env?: NodeJS.ProcessEnv;                          // 默认 process.env + HOME
}

export class LocalCommandExecutor implements CommandExecutor { /* spawn + 收集 stdout/stderr/exitCode + timeout */ }
export const localCommandExecutor = new LocalCommandExecutor({ command: '/bin/bash' });
```

pwsh 复用同一个类：`new LocalCommandExecutor({ command: resolvePwshPath(), args: (c) => [...PWSH_ARGS, c] })`。

### 4.6 SSH 执行器（`@vico/bash-ssh`）

```ts
export interface SshConnectionOptions {
  host: string;
  port?: number;          // 22
  username: string;
  password?: string;
  privateKey?: string | Buffer;
  passphrase?: string;
}

export class SshCommandExecutor implements CommandExecutor {
  constructor(options: SshConnectionOptions) {}
  execute(command: Command): Promise<CommandResult>;
  dispose(): Promise<void>; // 关闭底层连接
}
```

- 序列化：`[export ENV…]` + `cd '<cwd>' && ` + `command.raw`，经 `ssh2.Client.exec` 执行
  （exec channel，一次性命令，非 pty），流式收集 stdout/stderr，`close` 事件取退出码；
  timeout 用定时器触发后关闭 channel。
- 连接**惰性建立并复用**，失败时重建；`dispose()` 显式释放。
- **凭据走构造参数注入**（`SshConnectionOptions`）；本轮不接 `vico/server` 的 config / DI，无消费方。

## 5. 包结构与依赖方向

```
packages/bash/
├── package.json          # @vico/bash；零运行时依赖；dev: typescript/vitest/@types/node
├── tsconfig.json
├── README.md
└── src/
    ├── command.ts        # Command / CommandSegment / CommandResult 等类型
    ├── parse.ts          # parseCommand
    ├── analyze.ts        # analyzeCommand + COMMAND_REGISTRY + PathPolicy + Finding
    ├── policy.ts         # InterceptionPolicy + permissivePolicy + withPolicy
    ├── executor.ts       # CommandExecutor 接口
    ├── local-executor.ts # LocalCommandExecutor + localCommandExecutor 单例
    └── index.ts          # barrel

packages/bash-ssh/
├── package.json          # @vico/bash-ssh；deps: @vico/bash + ssh2
├── tsconfig.json
├── README.md
└── src/
    ├── ssh-executor.ts   # SshCommandExecutor + SshConnectionOptions
    └── index.ts
```

依赖方向（无环）：

```
@vico/bash            —— 零运行时依赖（端口 + 解析 + 分析 + 策略 + Local）
   ↑              ↑
@vico/bash-tool  @vico/bash-ssh —— 依赖 @vico/bash + ssh2（传输适配器）
   ↑
@vico/boot            —— 继续 import { shellTools }
```

> 说明：`packages/boot/DEPENDENCIES.md` 当前未包含 fs/fs-tool/bash-tool/browser-tool 等新拆分包，
> 属陈旧文档；本轮不更新，后续可单独补。

## 6. `@vico/bash-tool` 衔接

工具退化为薄壳，只做「参数 → `Command` → 执行」，不改对外导出与参数/输出 schema：

```ts
export function createBashTool(options?: { executor?: CommandExecutor }): Tool;
export function createPwshTool(options?: { executor?: CommandExecutor }): Tool;

export const bashTool = createBashTool();
export const pwshTool = createPwshTool();
export const shellTools: Tool[] = process.platform === 'win32' ? [pwshTool] : [bashTool];
export const pwshTools: Tool[] = [pwshTool];
```

- `bashTool` 的 `execute`：`cwd = resolveWorkspacePath(workspace, '.')` →
  `parseCommand(command, { cwd, timeout })` → `executor.execute(cmd)`；`dryRun` 仍走预览分支。
- `pwshTool` 的 `execute`：**不做 POSIX `parseCommand`/`analyzeCommand`**，直接
  `new LocalCommandExecutor({ command: resolvePwshPath(), args: (c) => [...PWSH_ARGS, c] })`
  执行；`dryRun` 走预览分支。
- 上游若要拦截，传 `createBashTool({ executor: withPolicy(localCommandExecutor, policy) })`。
- **被拦截结果的映射**（schema 不变）：`blocked` 时展平为 `stdout:''`、
  `stderr:'Blocked by policy: <reason>'`、`exitCode:null`。

## 7. 决策记录

**用户已定**：
- 解析为「结构化 + 可拦截」，不自造函数 DSL（`sleep(30)` 不作语法支持）。
- SSH 执行器本轮落地，但**只交付执行器类 + 配置类型，不接 server**。
- 拦截不拦截交给 `InterceptionPolicy` 接口，由上游决策。
- 拦截层与 `@vico/tool` 的 `approvalModeResolver` **本轮独立并存、不接线**。
- 包拆分为 `@vico/bash`（端口）+ `@vico/bash-ssh`（适配器）。

**我拍的板（可否决）**：
- 解析器手写、本轮 POSIX-only；pwsh 只执行、不 analyze。
- SSH 库选 `ssh2`；用 exec channel（一次性命令），远程交互终端不在本包范围。
- 命名 `parseCommand` / `analyzeCommand` / `InterceptionPolicy` / `withPolicy`。
- `SshCommandExecutor` 凭据走构造参数注入，连接惰性复用 + `dispose()`。
- 被拦截结果映射：`stdout:''` / `stderr:'Blocked by policy: <reason>'` / `exitCode:null`。

## 8. 留给实现者的部分

- `parse.ts` 具体词法/拆段实现与边界 case（`&&ls`、引号内分隔符、`||` 优先于 `|`）。
- `analyze.ts` 的 finding 枚举与路径 resolve/比对细节、`COMMAND_REGISTRY` 起步表。
- `ssh-executor.ts` 连接复用/超时/错误映射细节；`ssh2` 类型缺失时的最小声明。
- `@vico/bash` 单测：解析（含 `rm -rf /www/xxx &&ls -n` 用例）、分析（delete/路径越界/命令替换）、
  Local 执行 roundtrip。

## 9. 验证

```bash
pnpm --filter @vico/bash typecheck
pnpm --filter @vico/bash test
pnpm --filter @vico/bash-ssh typecheck
pnpm --filter @vico/bash-tool typecheck
pnpm --filter @vico/boot typecheck
cd vico/server && npx tsc --noEmit
```

运行期由用户验证：`pnpm dev` 聊天确认 `bash` 工具仍可用（默认不放策略，行为不变）。

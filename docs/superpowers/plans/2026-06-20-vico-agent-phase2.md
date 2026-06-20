# @vico/agent Phase 2 — 工具系统与 Skill 插件

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现完整的工具系统（LocalToolHost + 审批策略 + 并行执行）和 Skill 插件系统（SKILL.md 加载 + skill/skill_search/skill_read 工具），并集成进 AgentLoop。

**Architecture:** LocalToolHost 聚合多种工具来源（Builtin + Skill + Memory + RAG + MCP），通过 CapabilityRegistry 过滤；工具按审批策略（auto/on-request/suggest/never）执行，只读工具并行、变更工具串行。Skill 系统遵循 Agent Skills 规范（SKILL.md），通过 skill/skill_search/skill_read 三个工具按需加载。

**Tech Stack:** gray-matter（YAML frontmatter 解析）、p-limit（并发控制）、TypeScript 5.6+、Zod 4

## Global Constraints

- 所有新增代码在 `packages/agent/src/` 下
- ESM 模块，导入带 `.js` 扩展名
- 零循环依赖
- 不依赖 `@vico/server`，不依赖 Mastra
- 端口接口先行（已有 ToolHost、SkillLoader 端口）
- 新依赖：`gray-matter`（SKILL.md YAML 解析）、`p-limit`（并发控制）

---

## File Structure（新增/修改）

```
packages/agent/src/
├── tool/
│   ├── tool-host.ts                # 已有（接口），无需修改
│   ├── local-tool-host.ts          # NEW：LocalToolHost 实现
│   ├── capability-registry.ts      # NEW：能力注册表
│   ├── builtin-tools.ts            # NEW：内置工具集
│   ├── tool-policy.ts              # NEW：审批策略逻辑
│   └── storm-breaker.ts            # NEW：工具风暴断路器
├── skill/
│   ├── skill-loader.ts             # 已有（接口），无需修改
│   ├── fs-skill-loader.ts          # NEW：文件系统 Skill 加载器
│   ├── skill-manager.ts            # NEW：Skill 单例管理器
│   └── skill-tools.ts              # NEW：skill/skill_search/skill_read 工具
├── agent-loop/
│   └── agent-loop.ts               # MODIFY：dispatchTools 改用新 ToolHost
├── index.ts                        # MODIFY：导出新模块
└── __tests__/
    ├── local-tool-host.test.ts     # NEW
    ├── capability-registry.test.ts # NEW
    ├── storm-breaker.test.ts       # NEW
    ├── fs-skill-loader.test.ts     # NEW
    └── skill-tools.test.ts         # NEW
```

---

### Task 1: Add Dependencies

**Files:**
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Install gray-matter and p-limit**

```bash
cd /Users/taosikai/www/js/vico/packages/agent && pnpm add gray-matter p-limit
```

- [ ] **Step 2: Verify pnpm-lock.yaml updated**

```bash
git diff --stat pnpm-lock.yaml
```
Expected: lock file updated.

- [ ] **Step 3: Commit**

```bash
git add packages/agent/package.json pnpm-lock.yaml
git commit -m "chore(agent): add gray-matter and p-limit dependencies"
```

---

### Task 2: CapabilityRegistry

**Files:**
- Create: `packages/agent/src/tool/capability-registry.ts`

**Interfaces:**
- Produces: `CapabilityRegistry` class
  - `register(tool: ToolSpec, capabilities: string[]): void`
  - `filter(allowedNames?: string[]): ToolSpec[]`

- [ ] **Step 1: Write capability-registry.ts**

```typescript
// src/tool/capability-registry.ts
import type { ToolSpec } from '../contracts/tool.js';

/** 按 capability 标签管理工具注册与过滤 */
export class CapabilityRegistry {
  private tools: Map<string, { tool: ToolSpec; capabilities: string[] }> = new Map();

  register(tool: ToolSpec, capabilities: string[] = []): void {
    this.tools.set(tool.name, { tool, capabilities });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** 按 allowedNames 白名单 + capabilities 过滤 */
  filter(allowedNames?: string[], requiredCapabilities?: string[]): ToolSpec[] {
    const results: ToolSpec[] = [];
    for (const { tool, capabilities } of this.tools.values()) {
      // 白名单过滤
      if (allowedNames && !allowedNames.includes(tool.name)) continue;
      // capability 过滤
      if (requiredCapabilities && requiredCapabilities.length > 0) {
        const hasAll = requiredCapabilities.every((c) => capabilities.includes(c));
        if (!hasAll) continue;
      }
      results.push(tool);
    }
    return results;
  }

  get(name: string): ToolSpec | undefined {
    return this.tools.get(name)?.tool;
  }

  listAll(): ToolSpec[] {
    return Array.from(this.tools.values()).map((e) => e.tool);
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd packages/agent && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/tool/capability-registry.ts
git commit -m "feat(agent): implement CapabilityRegistry for tool filtering"
```

---

### Task 3: ToolPolicy + StormBreaker

**Files:**
- Create: `packages/agent/src/tool/tool-policy.ts`
- Create: `packages/agent/src/tool/storm-breaker.ts`

**Interfaces:**
- Produces:
  - `resolvePolicy(policy, context): ApprovalDecision`
  - `StormBreaker` class — `check(callName, callArgs): boolean`, `record(callName, callArgs): void`

- [ ] **Step 1: Write tool-policy.ts**

```typescript
// src/tool/tool-policy.ts
import type { ToolPolicy, ToolCall } from '../contracts/tool.js';
import type { ApprovalDecision } from './tool-host.js';

export interface PolicyContext {
  firstUse: boolean;
  previousApproved: boolean;
}

export function resolvePolicy(
  policy: ToolPolicy,
  call: ToolCall,
  ctx: PolicyContext,
): ApprovalDecision {
  switch (policy) {
    case 'auto':
      return { approved: true };
    case 'never':
      return { approved: false, reason: `Tool ${call.name} is blocked by policy` };
    case 'on-request':
      if (!ctx.firstUse && ctx.previousApproved) {
        return { approved: true }; // already approved for this session
      }
      return { approved: false, reason: `Tool ${call.name} requires user approval on first use` };
    case 'suggest':
      return { approved: true }; // suggest 不阻塞，仅记录
    default:
      return { approved: false, reason: `Unknown policy: ${policy}` };
  }
}
```

- [ ] **Step 2: Write storm-breaker.ts**

```typescript
// src/tool/storm-breaker.ts

interface CallRecord {
  name: string;
  argsKey: string;
  count: number;
  totalCount: number;
}

/** 工具风暴断路器 — 检测同一工具+参数组合的重复调用 */
export class StormBreaker {
  private records: Map<string, CallRecord> = new Map();
  private warnThreshold = 3;
  private killThreshold = 5;

  constructor(options?: { warnThreshold?: number; killThreshold?: number }) {
    if (options?.warnThreshold) this.warnThreshold = options.warnThreshold;
    if (options?.killThreshold) this.killThreshold = options.killThreshold;
  }

  /** 检查调用是否应被阻止。返回 true = 阻止 */
  check(callName: string, callArgs: Record<string, unknown>): { blocked: boolean; warning: boolean } {
    const key = `${callName}:${JSON.stringify(callArgs)}`;
    const record = this.records.get(key);
    if (!record) return { blocked: false, warning: false };
    return {
      warning: record.count >= this.warnThreshold && record.count < this.killThreshold,
      blocked: record.count >= this.killThreshold,
    };
  }

  record(callName: string, callArgs: Record<string, unknown>): void {
    const key = `${callName}:${JSON.stringify(callArgs)}`;
    const existing = this.records.get(key);
    if (existing) {
      existing.count++;
      existing.totalCount++;
    } else {
      this.records.set(key, { name: callName, argsKey: key, count: 1, totalCount: 1 });
    }
  }

  reset(): void {
    this.records.clear();
  }
}
```

- [ ] **Step 3: Verify compilation and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/tool/tool-policy.ts packages/agent/src/tool/storm-breaker.ts
git commit -m "feat(agent): implement ToolPolicy resolver and StormBreaker"
```

---

### Task 4: BuiltinTools

**Files:**
- Create: `packages/agent/src/tool/builtin-tools.ts`

**Interfaces:**
- Produces: `BuiltinTools.list()` — returns `ToolSpec[]`

- [ ] **Step 1: Write builtin-tools.ts**

```typescript
// src/tool/builtin-tools.ts
import type { ToolSpec } from '../contracts/tool.js';

/** 框架内置工具集 */
export const BuiltinTools: { list(): ToolSpec[] } = {
  list(): ToolSpec[] {
    return [
      {
        name: 'echo',
        description: 'Echo back the input. Useful for testing the tool execution pipeline.',
        inputSchema: {
          type: 'object',
          properties: { message: { type: 'string', description: 'Message to echo' } },
          required: ['message'],
        },
        policy: 'auto',
        kind: 'readonly',
      },
      {
        name: 'now',
        description: 'Get the current date and time in ISO 8601 format.',
        inputSchema: { type: 'object', properties: {} },
        policy: 'auto',
        kind: 'readonly',
      },
    ];
  },
};
```

- [ ] **Step 2: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/tool/builtin-tools.ts
git commit -m "feat(agent): add BuiltinTools (echo, now)"
```

---

### Task 5: LocalToolHost

**Files:**
- Create: `packages/agent/src/tool/local-tool-host.ts`

**Interfaces:**
- Consumes: `ToolHost` from `tool/tool-host.ts`, `CapabilityRegistry`, `StormBreaker`, `PolicyContext`
- Produces: `LocalToolHost` class implementing `ToolHost`
  - `listTools(ctx): Promise<ToolSpec[]>` — aggregate all tool sources, filter by capability
  - `execute(call, ctx): Promise<ToolResult>` — single tool with policy + storm check
  - `executeBatch(calls, ctx): Promise<ToolResult[]>` — parallel groups (readonly=3, rest sequential)

- [ ] **Step 1: Write local-tool-host.ts**

```typescript
// src/tool/local-tool-host.ts
import type { ToolSpec, ToolCall, ToolResult } from '../contracts/tool.js';
import type { ToolHost, ToolExecutionContext } from './tool-host.js';
import { CapabilityRegistry } from './capability-registry.js';
import { resolvePolicy } from './tool-policy.js';
import { StormBreaker } from './storm-breaker.js';
import { BuiltinTools } from './builtin-tools.js';

export interface ToolHandler {
  execute(call: ToolCall, ctx: ToolExecutionContext): Promise<unknown>;
}

export interface ToolSource {
  name: string;
  list(ctx: ToolExecutionContext): Promise<ToolSpec[]>;
  getHandler(name: string): ToolHandler | undefined;
}

/** LocalToolHost — 聚合多工具来源，实现审批策略和并行执行 */
export class LocalToolHost implements ToolHost {
  private registry: CapabilityRegistry = new CapabilityRegistry();
  private sources: ToolSource[] = [];
  private handlers: Map<string, ToolHandler> = new Map();
  private stormBreaker: StormBreaker = new StormBreaker();
  /** 跟踪 on-request 工具的审批状态 */
  private approvalState: Map<string, boolean> = new Map();

  constructor() {
    this.addBuiltinSource();
  }

  /** 注册工具来源 */
  addSource(source: ToolSource): void {
    this.sources.push(source);
  }

  async listTools(ctx: ToolExecutionContext): Promise<ToolSpec[]> {
    // 聚合所有来源
    const all: ToolSpec[] = [];
    for (const source of this.sources) {
      // 检查是否有 allowedToolNames 限制（由 agent config 指定）
      const tools = await source.list(ctx);
      for (const tool of tools) {
        this.registry.register(tool, [source.name]);
        this.handlers.set(tool.name, source.getHandler(tool.name) ?? {
          execute: async () => `Tool ${tool.name}: no handler registered`,
        });
      }
      all.push(...tools);
    }
    return all;
  }

  async execute(call: ToolCall, ctx: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.registry.get(call.name);
    if (!tool) {
      return { callId: call.id, name: call.name, status: 'error', error: `Tool ${call.name} not found` };
    }

    // 审批策略
    const firstUse = !this.approvalState.has(call.name);
    const previousApproved = this.approvalState.get(call.name) ?? false;
    const decision = resolvePolicy(tool.policy, call, { firstUse, previousApproved });

    if (!decision.approved) {
      // on-request: 需要外部审批
      if (tool.policy === 'on-request') {
        const approval = await ctx.awaitApproval(call);
        if (!approval.approved) {
          return { callId: call.id, name: call.name, status: 'error', error: approval.reason ?? 'User denied' };
        }
        this.approvalState.set(call.name, true);
      } else {
        return { callId: call.id, name: call.name, status: 'error', error: decision.reason ?? 'Blocked by policy' };
      }
    }

    // 风暴检测
    const storm = this.stormBreaker.check(call.name, call.args);
    if (storm.blocked) {
      return { callId: call.id, name: call.name, status: 'error', error: `Tool ${call.name} blocked by storm breaker: too many repeated calls` };
    }

    try {
      const handler = this.handlers.get(call.name);
      if (!handler) {
        return { callId: call.id, name: call.name, status: 'error', error: `No handler for ${call.name}` };
      }

      // PreToolUse hook
      if (ctx.hooks.length > 0) {
        for (const hook of ctx.hooks) {
          const result = await hook.run({ call });
          if (result.action === 'deny') {
            return { callId: call.id, name: call.name, status: 'error', error: result.message ?? 'Denied by hook' };
          }
        }
      }

      const output = await handler.execute(call, ctx);
      this.stormBreaker.record(call.name, call.args);

      return { callId: call.id, name: call.name, status: 'success', output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { callId: call.id, name: call.name, status: 'error', error: message };
    }
  }

  async executeBatch(calls: ToolCall[], ctx: ToolExecutionContext): Promise<ToolResult[]> {
    if (calls.length === 0) return [];
    if (calls.length === 1) return [await this.execute(calls[0], ctx)];

    // 按 kind 分组：readonly（可并行3个）+ 其他（串行）
    const readonly: ToolCall[] = [];
    const sequential: ToolCall[] = [];

    for (const call of calls) {
      const tool = this.registry.get(call.name);
      if (tool?.kind === 'readonly') {
        readonly.push(call);
      } else {
        sequential.push(call);
      }
    }

    // 只读工具并行（最多 3 个一组）
    const results: ToolResult[] = [];
    for (let i = 0; i < readonly.length; i += 3) {
      const batch = readonly.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map((c) => this.execute(c, ctx)));
      results.push(...batchResults);
    }

    // 变更工具串行
    for (const call of sequential) {
      results.push(await this.execute(call, ctx));
    }

    return results;
  }

  private addBuiltinSource(): void {
    this.addSource({
      name: 'builtin',
      list: async () => BuiltinTools.list(),
      getHandler: (name: string): ToolHandler => {
        const handlers: Record<string, ToolHandler> = {
          echo: { execute: async (call) => (call.args as any).message ?? '' },
          now: { execute: async () => new Date().toISOString() },
        };
        return handlers[name] ?? { execute: async () => `No handler for builtin:${name}` };
      },
    });
  }

  /** 暴露 storm breaker 供外部重置 */
  resetStormBreaker(): void {
    this.stormBreaker.reset();
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd packages/agent && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/tool/local-tool-host.ts
git commit -m "feat(agent): implement LocalToolHost with policy, storm breaker, and parallel execution"
```

---

### Task 6: FSSkillLoader

**Files:**
- Create: `packages/agent/src/skill/fs-skill-loader.ts`

**Interfaces:**
- Consumes: `SkillLoader`, `Skill` from `skill/skill-loader.ts`
- Produces: `FSSkillLoader` class implementing `SkillLoader`
  - `discover(roots: string[]): Promise<Skill[]>` — scan directories for SKILL.md
  - `load(skillPath: string): Promise<Skill>` — parse YAML frontmatter + Markdown body
  - `refresh(roots: string[]): Promise<void>` — re-scan

- [ ] **Step 1: Write fs-skill-loader.ts**

```typescript
// src/skill/fs-skill-loader.ts
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type { Skill, SkillLoader } from './skill-loader.js';

/** 简易 YAML frontmatter 解析器，避免 gray-matter 的 ESM 兼容问题 */
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };

  const data: Record<string, unknown> = {};
  const yamlBlock = match[1];
  // 简易解析：仅支持 key: value 格式
  for (const line of yamlBlock.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else if (/^\d+$/.test(value)) data[key] = parseInt(value, 10);
    else data[key] = value;
  }

  return { data, body: match[2] };
}

/** 验证 SKILL.md 的 name 字段：1-64 字符，小写字母+连字符 */
function validateSkillName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(name) && name.length >= 1 && name.length <= 64;
}

function listDir(dir: string): string[] {
  try {
    const entries = readdirSync(dir);
    return entries.map((e) => resolve(dir, e));
  } catch {
    return [];
  }
}

/** 文件系统 Skill 加载器 — 扫描目录中的 SKILL.md 文件 */
export class FSSkillLoader implements SkillLoader {
  private loadedSkills: Map<string, Skill> = new Map();

  async discover(roots: string[]): Promise<Skill[]> {
    const candidates: string[] = [];

    for (const root of roots) {
      const fullPath = resolve(root);

      // root 本身是否包含 SKILL.md？
      const directMd = resolve(fullPath, 'SKILL.md');
      if (existsSync(directMd)) {
        candidates.push(fullPath);
      }

      // 扫描一级子目录
      for (const entry of listDir(fullPath)) {
        try {
          if (statSync(entry).isDirectory()) {
            const subMd = resolve(entry, 'SKILL.md');
            if (existsSync(subMd)) {
              candidates.push(entry);
            }
          }
        } catch { /* skip */ }
      }
    }

    // 加载每个候选项
    const skills: Skill[] = [];
    for (const candidate of candidates) {
      try {
        const skill = await this.loadSkillFromDir(candidate);
        const existing = this.loadedSkills.get(skill.name);
        if (!existing) {
          this.loadedSkills.set(skill.name, skill);
          skills.push(skill);
        }
      } catch { /* skip invalid skill */ }
    }

    return skills;
  }

  async load(skillPath: string): Promise<Skill> {
    const fullPath = resolve(skillPath);
    if (!existsSync(resolve(fullPath, 'SKILL.md'))) {
      throw new Error(`SKILL.md not found in ${fullPath}`);
    }
    return this.loadSkillFromDir(fullPath);
  }

  async refresh(roots: string[]): Promise<void> {
    this.loadedSkills.clear();
    await this.discover(roots);
  }

  private async loadSkillFromDir(dir: string): Promise<Skill> {
    const mdPath = resolve(dir, 'SKILL.md');
    const content = readFileSync(mdPath, 'utf-8');
    const { data, body } = parseFrontmatter(content);

    const name = data.name as string;
    if (!validateSkillName(name)) {
      throw new Error(`Invalid skill name in ${dir}: "${name}". Must be 1-64 lowercase alphanumeric with hyphens.`);
    }

    const referenceDir = resolve(dir, 'references');
    const scriptsDir = resolve(dir, 'scripts');
    const assetsDir = resolve(dir, 'assets');

    return {
      name,
      description: (data.description as string) || '',
      instructions: body.trim(),
      path: dir,
      source: 'local',
      license: data.license as string | undefined,
      compatibility: data.compatibility as string | undefined,
      userInvocable: data['user-invocable'] !== false,
      references: existsSync(referenceDir) ? readdirSync(referenceDir) : [],
      scripts: existsSync(scriptsDir) ? readdirSync(scriptsDir) : [],
      assets: existsSync(assetsDir) ? readdirSync(assetsDir) : [],
      metadata: data.metadata as Record<string, string> | undefined,
    };
  }
}
```

- [ ] **Step 2: Verify compilation**

```bash
cd packages/agent && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/skill/fs-skill-loader.ts
git commit -m "feat(agent): implement FSSkillLoader for SKILL.md discovery and parsing"
```

---

### Task 7: SkillManager + SkillTools

**Files:**
- Create: `packages/agent/src/skill/skill-manager.ts`
- Create: `packages/agent/src/skill/skill-tools.ts`

**Interfaces:**
- Produces:
  - `SkillManager` singleton — `discover()`, `get(name)`, `listAll()`, `search(query)`, `read(name, filePath)`
  - `createSkillTools(skillManager)` → returns `ToolSpec[]` for skill/skill_search/skill_read

- [ ] **Step 1: Write skill-manager.ts**

```typescript
// src/skill/skill-manager.ts
import type { Skill } from './skill-loader.js';
import type { FSSkillLoader } from './fs-skill-loader.js';

export class SkillManager {
  private skills: Map<string, Skill> = new Map();
  private loader: FSSkillLoader;
  private roots: string[] = [];

  constructor(loader: FSSkillLoader) {
    this.loader = loader;
  }

  async discover(roots: string[]): Promise<void> {
    this.roots = roots;
    const discovered = await this.loader.discover(roots);
    for (const skill of discovered) {
      this.skills.set(skill.name, skill);
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  listAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** 简单关键词搜索 — 匹配 name 和 description */
  search(query: string, limit = 10): Array<{ name: string; description: string; score: number }> {
    const q = query.toLowerCase();
    const results: Array<{ name: string; description: string; score: number }> = [];
    for (const skill of this.skills.values()) {
      let score = 0;
      if (skill.name.toLowerCase().includes(q)) score += 10;
      if (skill.description.toLowerCase().includes(q)) score += 5;
      if (skill.instructions.toLowerCase().includes(q)) score += 1;
      if (score > 0) {
        results.push({ name: skill.name, description: skill.description, score });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async refresh(): Promise<void> {
    this.skills.clear();
    await this.discover(this.roots);
  }
}
```

- [ ] **Step 2: Write skill-tools.ts**

```typescript
// src/skill/skill-tools.ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { ToolSpec } from '../contracts/tool.js';
import type { SkillManager } from './skill-manager.js';

export function createSkillTools(manager: SkillManager): ToolSpec[] {
  return [
    {
      name: 'skill',
      description:
        'Load the full instructions for a skill by name. Use this when you need detailed guidance from a specific skill.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The skill name to load' },
        },
        required: ['name'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
    {
      name: 'skill_search',
      description: 'Search across all available skills by keyword. Returns matching skills with relevance scores.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 10)' },
        },
        required: ['query'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
    {
      name: 'skill_read',
      description: 'Read a file from a skill\'s references, scripts, or assets directory.',
      inputSchema: {
        type: 'object',
        properties: {
          skillName: { type: 'string', description: 'The skill name' },
          filePath: { type: 'string', description: 'Relative path within the skill directory' },
        },
        required: ['skillName', 'filePath'],
      },
      policy: 'auto',
      kind: 'readonly',
    },
  ];
}

/** 创建 skill 工具的 handler */
export function createSkillToolHandlers(manager: SkillManager) {
  return {
    skill: {
      execute: async (call: { name: string }) => {
        const skill = manager.get(call.name);
        if (!skill) return `Skill "${call.name}" not found. Available: ${manager.listAll().map((s) => s.name).join(', ')}`;
        return JSON.stringify({
          name: skill.name,
          description: skill.description,
          instructions: skill.instructions,
          references: skill.references,
          scripts: skill.scripts,
          assets: skill.assets,
        });
      },
    },
    skill_search: {
      execute: async (call: { query: string; limit?: number }) => {
        const results = manager.search(call.query, call.limit ?? 10);
        return JSON.stringify(results);
      },
    },
    skill_read: {
      execute: async (call: { skillName: string; filePath: string }) => {
        const skill = manager.get(call.skillName);
        if (!skill) return `Skill "${call.skillName}" not found`;
        const fullPath = resolve(skill.path, call.filePath);
        if (!existsSync(fullPath)) return `File not found: ${call.filePath}`;
        try {
          return readFileSync(fullPath, 'utf-8');
        } catch {
          return `Cannot read file: ${call.filePath} (may be binary)`;
        }
      },
    },
  };
}
```

- [ ] **Step 3: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/skill/skill-manager.ts packages/agent/src/skill/skill-tools.ts
git commit -m "feat(agent): implement SkillManager and skill/skill_search/skill_read tools"
```

---

### Task 8: Integrate into AgentLoop + Update Index

**Files:**
- Modify: `packages/agent/src/agent-loop/agent-loop.ts`
- Modify: `packages/agent/src/index.ts`

**Interfaces:**
- Consumes: `LocalToolHost`, `SkillManager`, `createSkillTools`, `createSkillToolHandlers`

- [ ] **Step 1: Update agent-loop dispatchTools**

The `dispatchTools` method currently uses a placeholder. Replace with the real LocalToolHost call. Since `LocalToolHost` is passed in via `AgentLoopOptions.toolHost`, the loop itself doesn't change — the integration point is external. No changes needed to agent-loop.ts.

- [ ] **Step 2: Update index.ts exports**

Add to index.ts:
```typescript
// Tool system
export { LocalToolHost, type ToolSource, type ToolHandler } from './tool/local-tool-host.js';
export { CapabilityRegistry } from './tool/capability-registry.js';
export { StormBreaker } from './tool/storm-breaker.js';
export { resolvePolicy, type PolicyContext } from './tool/tool-policy.js';
export { BuiltinTools } from './tool/builtin-tools.js';

// Skill system
export { FSSkillLoader } from './skill/fs-skill-loader.js';
export { SkillManager } from './skill/skill-manager.js';
export { createSkillTools, createSkillToolHandlers } from './skill/skill-tools.js';
```

- [ ] **Step 3: Verify and commit**

```bash
cd packages/agent && npx tsc --noEmit
git add packages/agent/src/agent-loop/agent-loop.ts packages/agent/src/index.ts
git commit -m "feat(agent): integrate tool and skill systems into AgentLoop and public API"
```

---

### Task 9: Unit Tests

**Files:**
- Create: `packages/agent/src/__tests__/capability-registry.test.ts`
- Create: `packages/agent/src/__tests__/storm-breaker.test.ts`
- Create: `packages/agent/src/__tests__/local-tool-host.test.ts`
- Create: `packages/agent/src/__tests__/fs-skill-loader.test.ts`
- Create: `packages/agent/src/__tests__/skill-tools.test.ts`

- [ ] **Step 1: Write capability-registry tests**

```typescript
// src/__tests__/capability-registry.test.ts
import { describe, it, expect } from 'vitest';
import { CapabilityRegistry } from '../tool/capability-registry.js';

const mockTool = (name: string) => ({ name, description: '', inputSchema: {}, policy: 'auto' as const, kind: 'readonly' as const });

describe('CapabilityRegistry', () => {
  it('registers and retrieves tools', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    expect(reg.get('a')).toBeDefined();
    expect(reg.get('b')).toBeUndefined();
  });

  it('filters by allowed names', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), []);
    reg.register(mockTool('b'), []);
    reg.register(mockTool('c'), []);
    const filtered = reg.filter(['a', 'c']);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('filters by capabilities', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    reg.register(mockTool('b'), ['write']);
    reg.register(mockTool('c'), ['read', 'write']);
    const filtered = reg.filter(undefined, ['read']);
    expect(filtered.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('combines name + capability filters', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), ['read']);
    reg.register(mockTool('b'), ['read']);
    reg.register(mockTool('c'), ['write']);
    const filtered = reg.filter(['a', 'c'], ['read']);
    expect(filtered.map((t) => t.name)).toEqual(['a']);
  });

  it('unregister removes tool', () => {
    const reg = new CapabilityRegistry();
    reg.register(mockTool('a'), []);
    reg.unregister('a');
    expect(reg.get('a')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write storm-breaker tests**

```typescript
// src/__tests__/storm-breaker.test.ts
import { describe, it, expect } from 'vitest';
import { StormBreaker } from '../tool/storm-breaker.js';

describe('StormBreaker', () => {
  it('allows first calls', () => {
    const sb = new StormBreaker();
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: false });
  });

  it('warns after threshold', () => {
    const sb = new StormBreaker({ warnThreshold: 2, killThreshold: 5 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: true });
  });

  it('blocks after kill threshold', () => {
    const sb = new StormBreaker({ warnThreshold: 2, killThreshold: 3 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: true, warning: false });
  });

  it('different args are tracked separately', () => {
    const sb = new StormBreaker({ warnThreshold: 1, killThreshold: 2 });
    sb.record('echo', { msg: 'a' });
    sb.record('echo', { msg: 'a' });
    expect(sb.check('echo', { msg: 'b' })).toEqual({ blocked: false, warning: false });
  });

  it('reset clears all records', () => {
    const sb = new StormBreaker({ killThreshold: 2 });
    sb.record('echo', { msg: 'hi' });
    sb.record('echo', { msg: 'hi' });
    sb.reset();
    expect(sb.check('echo', { msg: 'hi' })).toEqual({ blocked: false, warning: false });
  });
});
```

- [ ] **Step 3: Write local-tool-host tests**

```typescript
// src/__tests__/local-tool-host.test.ts
import { describe, it, expect } from 'vitest';
import { LocalToolHost } from '../tool/local-tool-host.js';

function makeCtx(overrides?: Record<string, unknown>): any {
  return {
    tenantId: 't1', userId: 'u1', agentId: 'a1', threadId: 'th1',
    workspace: '/tmp', hooks: [],
    awaitApproval: async () => ({ approved: true }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe('LocalToolHost', () => {
  it('lists builtin tools', async () => {
    const host = new LocalToolHost();
    const tools = await host.listTools(makeCtx());
    expect(tools.some((t) => t.name === 'echo')).toBe(true);
    expect(tools.some((t) => t.name === 'now')).toBe(true);
  });

  it('executes echo tool', async () => {
    const host = new LocalToolHost();
    await host.listTools(makeCtx()); // initialize
    const result = await host.execute({ id: '1', name: 'echo', args: { message: 'hello' } }, makeCtx());
    expect(result.status).toBe('success');
    expect(result.output).toBe('hello');
  });

  it('executes now tool', async () => {
    const host = new LocalToolHost();
    await host.listTools(makeCtx());
    const result = await host.execute({ id: '2', name: 'now', args: {} }, makeCtx());
    expect(result.status).toBe('success');
    expect(typeof result.output).toBe('string');
  });

  it('returns error for unknown tool', async () => {
    const host = new LocalToolHost();
    await host.listTools(makeCtx());
    const result = await host.execute({ id: '3', name: 'nonexistent', args: {} }, makeCtx());
    expect(result.status).toBe('error');
  });

  it('executes batch with readonly parallel', async () => {
    const host = new LocalToolHost();
    await host.listTools(makeCtx());
    const results = await host.executeBatch([
      { id: '1', name: 'echo', args: { message: 'a' } },
      { id: '2', name: 'echo', args: { message: 'b' } },
    ], makeCtx());
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('blocks never-policy tool', async () => {
    const host = new LocalToolHost();
    host.addSource({
      name: 'test',
      list: async () => [{ name: 'dangerous', description: '', inputSchema: {}, policy: 'never', kind: 'command' }],
      getHandler: () => ({ execute: async () => 'should not run' }),
    });
    await host.listTools(makeCtx());
    const result = await host.execute({ id: 'x', name: 'dangerous', args: {} }, makeCtx());
    expect(result.status).toBe('error');
    expect(result.error).toContain('blocked by policy');
  });
});
```

- [ ] **Step 4: Write fs-skill-loader tests**

Create a temp skill directory and test discovery:

```typescript
// src/__tests__/fs-skill-loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';

const TMP = resolve('/tmp/vico-skill-test-' + Date.now());

function createSkill(dir: string, name: string, description: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n\nTest skill.`,
  );
}

describe('FSSkillLoader', () => {
  beforeEach(() => mkdirSync(TMP, { recursive: true }));
  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('discovers skill from root directory', async () => {
    createSkill(TMP, 'test-skill', 'A test skill');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('test-skill');
  });

  it('discovers skills from subdirectories', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    createSkill(resolve(TMP, 'skill-b'), 'skill-b', 'Second');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(2);
  });

  it('loads single skill by path', async () => {
    createSkill(resolve(TMP, 'my-skill'), 'my-skill', 'My skill');
    const loader = new FSSkillLoader();
    const skill = await loader.load(resolve(TMP, 'my-skill'));
    expect(skill.name).toBe('my-skill');
    expect(skill.instructions).toContain('Test skill');
  });

  it('refresh clears and reloads', async () => {
    createSkill(resolve(TMP, 'skill-a'), 'skill-a', 'First');
    const loader = new FSSkillLoader();
    await loader.discover([TMP]);
    expect((await loader.discover([TMP]))).toHaveLength(1);
    // Add another skill and refresh
    createSkill(resolve(TMP, 'skill-b'), 'skill-b', 'Second');
    await loader.refresh([TMP]);
    const afterRefresh = await loader.discover([TMP]);
    expect(afterRefresh).toHaveLength(2);
  });

  it('rejects skill with invalid name', async () => {
    mkdirSync(resolve(TMP, 'bad-skill'), { recursive: true });
    writeFileSync(resolve(TMP, 'bad-skill', 'SKILL.md'), '---\nname: INVALID NAME\n---\n\nbad');
    const loader = new FSSkillLoader();
    const skills = await loader.discover([TMP]);
    expect(skills).toHaveLength(0); // silently skipped
  });
});
```

- [ ] **Step 5: Write skill-tools tests**

```typescript
// src/__tests__/skill-tools.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { SkillManager } from '../skill/skill-manager.js';
import { FSSkillLoader } from '../skill/fs-skill-loader.js';
import { createSkillTools, createSkillToolHandlers } from '../skill/skill-tools.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const TMP = resolve('/tmp/vico-skill-tools-test-' + Date.now());

function createSkill(dir: string, name: string, description: string, instructions = '# Instructions'): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n${instructions}`);
}

describe('SkillTools', () => {
  let manager: SkillManager;

  beforeEach(async () => {
    mkdirSync(TMP, { recursive: true });
    createSkill(resolve(TMP, 'code-review'), 'code-review', 'Review code changes', 'Check for bugs and style issues.');
    createSkill(resolve(TMP, 'deploy'), 'deploy', 'Deployment guide', 'Steps to deploy the application.');
    const loader = new FSSkillLoader();
    manager = new SkillManager(loader);
    await manager.discover([TMP]);
  });

  afterEach(() => rmSync(TMP, { recursive: true, force: true }));

  it('skill tool returns instructions', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill.execute({ name: 'code-review' });
    const parsed = JSON.parse(result);
    expect(parsed.name).toBe('code-review');
    expect(parsed.instructions).toContain('Check for bugs');
  });

  it('skill tool returns error for unknown skill', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill.execute({ name: 'nonexistent' });
    expect(result).toContain('not found');
  });

  it('skill_search finds matching skills', async () => {
    const handlers = createSkillToolHandlers(manager);
    const result = await handlers.skill_search.execute({ query: 'review' });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('code-review');
  });

  it('skill_tools creates 3 tools', () => {
    const tools = createSkillTools(manager);
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name).sort()).toEqual(['skill', 'skill_read', 'skill_search']);
  });
});
```

- [ ] **Step 6: Run all tests**

```bash
cd packages/agent && npx vitest run
```
Expected: all existing 34 + new ~18 tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/src/__tests__/
git commit -m "test(agent): add tests for tool and skill systems"
```

---

## Verification Checklist

```bash
# 1. TypeScript compiles
cd packages/agent && npx tsc --noEmit

# 2. All tests pass
cd packages/agent && npx vitest run

# 3. No Mastra imports anywhere
grep -r "mastra" packages/agent/src/ || echo "Clean"
```

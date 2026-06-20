# Kun Skill 设计与执行机制

## 一、Skill 定义体系

Kun 的 Skill 系统是**完全基于文件系统**的插件机制。不使用数据库，不需要安装/卸载操作，扫描目录即用。

### 1.1 两种 Skill 格式

#### Modern 格式（`skill.json`）

Zod Schema 定义（`kun/src/skills/skill-runtime.ts` 第 17 行）：

```typescript
{
  id?: string,                // 唯一标识（不存在时从 name 生成）
  name: string,               // 必填，显示名称
  description?: string,       // 简短描述
  version?: string,           // 默认 '0.0.0'
  entry?: string,             // 入口文件相对路径，默认 'SKILL.md'
  triggers: {                 // 激活触发器
    commands: string[],       // 提示词前缀命令触发器，如 ["/review"]
    promptPatterns: string[], // 正则表达式，匹配完整提示词
    fileTypes: string[]       // 文件扩展名，如 [".ts", ".md"]
  },
  allowedTools: string[],     // 激活时限制模型只能使用这些工具
  assets: string[],           // 资源文件路径
  priority: number            // 优先级偏移量，默认 0
}
```

#### Legacy 格式（`SKILL.md` YAML 前置元数据）

```markdown
---
id: my-skill
name: My Skill
description: A useful skill
---

# Instructions content...
```

传统格式**无触发器、无工具约束、无资源、无版本号**，所有值使用默认值。

### 1.2 运行时表示（LoadedSkill）

```typescript
interface LoadedSkill {
  id: string
  name: string
  description?: string
  version: string
  root: string              // 绝对路径（Skill 目录）
  entryPath: string         // 入口文件绝对路径
  entry: string             // 入口文件原始内容
  triggers: { commands, promptPatterns, fileTypes }
  allowedTools: string[]
  assets: string[]          // 已解析的绝对路径
  priority: number
  legacy: boolean
}
```

---

## 二、Skill 发现机制

### 2.1 发现入口

文件：`kun/src/skills/skill-runtime.ts` 第 302 行

```typescript
function discoverSkills(roots: SkillRoot[]): LoadedSkill[]
```

### 2.2 目录扫描算法

```
discoverSkills(roots):
  for each root in roots:
    // 步骤 1：root 本身是否包含 skill.json 或 SKILL.md？
    if root has skill.json or SKILL.md:
      add root as candidate package

    // 步骤 2：扫描 root 的**一级子目录**
    for each subdirectory in root:
      if subdirectory has skill.json or SKILL.md:
        add subdirectory as candidate package

      // 处理符号链接
      if subdirectory is a symlink resolving to a directory:
        add resolved directory as candidate package

  // 步骤 3：加载每个候选项
  for each candidate:
    package = loadSkillPackage(candidate)
      // 优先 skill.json，回退到 SKILL.md

  // 步骤 4：按 id 去重，第一个胜出
  return deduplicated by id（first wins）
```

### 2.3 扫描根目录配置

文件：`src/shared/skill-dirs.ts`

Skills 从以下位置发现，按**优先级顺序**：

#### 项目级目录（相对于当前工作区）：

| 优先级 | 路径 |
|--------|------|
| 1 (最高) | `.agents/skills/` |
| 2 | `.claude/skills/` |
| 3 | `.codex/skills/` |
| 4 | `skills/` |

#### 全局目录（相对于 `$HOME`）：

| 优先级 | 路径 |
|--------|------|
| 1 (最高) | `.agents/skills/` |
| 2 | `.claude/skills/` |
| 3 | `.codex/skills/` |
| 4 | `.kun/skills/` |

#### 额外目录：

- **Codex 插件缓存**：`$HOME/.codex/plugins/cache/`，深度 5 递归搜索 `skills/` 子目录
- **用户配置的额外目录**：`claw.skills.extraDirs` + `schedule.skills.extraDirs`
- **禁用列表**：`disabledDirs` 中的目录被排除

### 2.4 去重规则

按路径比较，**先发现的胜出**。这保证了：
- 项目级 Skills 覆盖全局 Skills
- `.agents/skills/` 优先级高于 `.claude/skills/`

---

## 三、Skill 加载与注册

### 3.1 SkillRuntime 类

文件：`kun/src/skills/skill-runtime.ts` 第 89 行

```typescript
class SkillRuntime {
  // 创建
  static create(config: SkillsCapabilityConfig, options): SkillRuntime
    // 如果 enabled:true → 立即执行 discoverSkills()
    // 如果 enabled:false → 不加载任何 Skill

  // 刷新（动态添加新 Skill 后）
  refresh(): void
    // 重新扫描所有配置的根目录
    // 重新加载 Skill

  // 每轮 Turn 激活
  resolveTurn(input): SkillResolution
    // 匹配用户提示词和工作区文件与 Skill 的触发器
    // 返回激活的 Skill 和编译的指令

  // 按需加载（load_skill 工具）
  loadSkillById(id: string): LoadedSkill | undefined

  // 目录指令生成
  catalogInstruction(): string
    // 生成"始终可见"的 Skill 目录，限额 8KB

  // 诊断信息
  diagnostics(): SkillDiagnostics
}
```

### 3.2 运行时工厂中的注册

文件：`kun/src/server/runtime-factory.ts` 第 172-243 行

```
启动时：
  1. SkillRuntime.create(options.capabilities.skills)
  2. catalogInstruction() 输出注入不可变系统提示词前缀
     → 利用 Prompt 缓存，避免每次 Turn 重复计算
  3. SkillRuntime 传递给 AgentLoop 和 ChildAgentExecutor
  4. buildSkillToolProviders() 注册 load_skill 工具
```

---

## 四、Skill 激活机制

### 4.1 触发匹配

文件：`kun/src/loop/agent-loop.ts` 第 1055 行

```typescript
const skillResolution = this.opts.skillRuntime?.resolveTurn({
  prompt: turn?.prompt ?? '',
  workspace: thread?.workspace ?? ''
})
```

### 4.2 匹配类型与评分

文件：`kun/src/skills/skill-runtime.ts` 第 268 行

| 匹配类型 | 触发方式 | 基础分 |
|---------|---------|--------|
| **显式提及** | 提示词中出现 `$id`、`@id`、`/skill:id` | **1000** |
| **命令前缀** | 提示词以 `commands[]` 中的一个条目开头 | **900** |
| **正则模式** | `promptPatterns[]` 中的正则匹配提示词 | **500** |
| **文件类型** | 工作区或提示词中出现的文件扩展名匹配 `fileTypes[]` | **300** |

**最终排序**：`baseScore + priority` 降序排列。

**激活上限**：仅激活前 `activeLimit`（默认 3）个 Skill。

### 4.3 Skill 激活后的效果

1. **指令注入**：激活的 Skill 的 `entry`（SKILL.md 内容）作为上下文指令注入
2. **工具约束**：`allowedTools` 非空时，限制 Agent 只能使用指定的工具
3. **元数据记录**：`activeSkillIds` + `skillInjectionBytes` 记入 Turn 元数据
4. **跨轮持久**：压缩上下文时，Skill Pins 被保留并传递给压缩摘要

---

## 五、Skill 执行流程

### 5.1 两种使用方式

#### 方式一：触发式自动激活

```
用户输入 → 触发器匹配 → Skill 自动激活 → 指令注入 LLM 上下文
```

每轮 Turn 都会重新匹配。Skill 指令与系统提示词、记忆等一起作为上下文指令发送给 LLM。

#### 方式二：按需加载（`load_skill` 工具）

文件：`kun/src/adapters/tool/skill-tool-provider.ts`

```typescript
// LLM 可以调用 load_skill 工具：
{
  name: 'load_skill',
  arguments: { skill_id: 'my-skill' }
}

// 返回：
{
  name: 'My Skill',
  instruction: '完整的 SKILL.md 内容...',
  allowedTools: ['read', 'bash', 'edit', ...],
  truncated: false  // 是否因超出限额被截断
}
```

该工具：
- Policy: `auto`（无需审批，自动执行）
- 仅在 Skills 启用且至少加载了一个 Skill 时注册
- 返回完整的 Skill 指令文本

### 5.2 始终可见的目录

`catalogInstruction()` 输出始终注入到系统提示词前缀中。包含：
- 所有可用 Skill 的 ID、名称、描述
- 如何使用 `load_skill` 工具拉取完整指令
- 字节预算：默认 8KB（`catalogBudgetBytes`），超出截断

这让 LLM 即使在没有触发器匹配的情况下也能知道有哪些 Skill 可用。

### 5.3 工具允许列表机制

当 Skill 指定了 `allowedTools`：
1. **Schema/广告层面**：不在列表中的工具不会发送给 LLM
2. **执行层面**：即使请求了，执行时也会被拒绝
3. **交叉**：当 Skill 允许列表与子 Agent 只读限制同时存在时，取交集

---

## 六、Agent Loop 中的 Skill 集成

### 6.1 上下文注入位置

文件：`kun/src/loop/agent-loop.ts` 第 1078-1194 行

```
构建模型请求前的上下文指令组装顺序：
  1. Goal 继续指令
  2. Goal 无工具重复恢复指令
  3. Todo 继续指令
  4. 空 Post-Tool 恢复指令
  5. Memory 注入指令
  6. Skill 指令 ← 在此处注入
  7. 用户输入不可用警告
  8. Shell 运行时指令
  9. 工具目录漂移消息
```

### 6.2 Skill 允许列表执行

文件：`kun/src/loop/agent-loop.ts` 第 1078-1080 行

```typescript
// 收集所有激活 Skill 的允许工具
const skillAllowedTools = [
  ...new Set(
    skillResolution.resolutions.flatMap(r => r.skill.allowedTools)
  )
]

// 如果存在允许列表，则将 allowed-tool-names 传入工具上下文
// CapabilityRegistry 会据此过滤工具
```

### 6.3 子 Agent 集成

文件：`kun/src/delegation/child-agent-executor.ts` 第 106 行

子 Agent **共享父 Agent 的 SkillRuntime**：
- 子 Agent 继承 Skill 激活能力
- 子 Agent 拥有 `load_skill` 工具
- 子 Agent 的工具允许列表与只读限制取交集

### 6.4 上下文压缩中的 Skill 保留

文件：`kun/src/loop/context-compactor.ts` 第 342 行

```typescript
function extractSkillPins(history: string): string[] {
  // 扫描历史记录中匹配以下模式的行：
  // - "Active Skill: xxx"
  // - "Skill Pin: xxx"
  // - "Pinned Skill: xxx"
  // 保留在压缩摘要中，标记为：
  // "Pinned skills (preserved across compaction)"
}
```

---

## 七、HTTP API 暴露

文件：`kun/src/server/routes/skills.ts`

```
GET /v1/skills

Response:
{
  "enabled": true,
  "roots": ["/path/to/.agents/skills", "/path/to/skills"],
  "skills": [
    {
      "id": "my-skill",
      "name": "My Skill",
      "description": "...",
      "version": "1.0.0",
      "root": "/path/to/skill",
      "entryPath": "/path/to/skill/SKILL.md",
      "triggers": { ... },
      "allowedTools": [...],
      "legacy": false,
      "priority": 0
    }
  ],
  "validationErrors": []
}
```

---

## 八、默认配置参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `activeLimit` | 3 | 每轮 Turn 最多激活的 Skill 数 |
| `instructionBudgetBytes` | 24,000 | 每个 Skill 注入上下文的内容字节上限 |
| `catalogBudgetBytes` | 8,000 | 始终可见的目录的字节上限 |
| `legacySkillMd` | true | 是否支持 SKILL.md 格式 |
| `enabled` | false | 默认关闭，需手动启用 |

---

## 九、与 Vico Skill 系统对比

| 维度 | Kun | Vico |
|------|-----|------|
| 定位 | 用户自定义"微提示词/微规则" | 即插即用 Skill 插件 |
| 格式 | `skill.json` + `SKILL.md`（内容为纯指令文本） | `manifest.json` + `prompt.md` + `tools.ts`（可包含可执行代码） |
| 发现 | 多级目录扫描（项目 + 全局 + 插件缓存） | 单目录扫描（文件系统 / 安装） |
| 触发 | 触发器匹配（命令/正则/文件类型/显式提及） | 按 Agent 绑定 |
| 工具 | 仅 `load_skill`（按需加载指令文本） | 每个 Skill 可导出任意多个 `SkillTool` |
| 代码执行 | **无**（Skill 只是文本指令注入） | **有**（`tools.ts` 动态 import 执行） |
| 允许列表 | Skill 可限制 LLM 的工具范围 | 无此概念 |
| 目录 | 始终注入工具目录到系统提示词 | 无此概念 |
| 压缩保留 | Skill Pins 在上下文压缩时被保留 | 无此概念 |
| 子 Agent | 子 Agent 继承 Skill | 无子 Agent 概念 |
| 优先级 | 评分 + 优先级排序 | 无 |

---

## 十、关键文件索引

| 文件 | 职责 |
|------|------|
| `kun/src/skills/skill-runtime.ts` | Skill 运行时核心（发现、匹配、注入） |
| `kun/src/adapters/tool/skill-tool-provider.ts` | `load_skill` 工具实现 |
| `kun/src/contracts/capabilities.ts` | SkillsCapabilityConfig Schema |
| `src/main/services/skill-service.ts` | GUI 侧 Skill 根目录解析服务 |
| `src/shared/skill-dirs.ts` | Skill 目录优先级定义 |
| `src/renderer/src/lib/skill-root-preference.ts` | 前端 Skill 根目录偏好 |
| `kun/src/server/routes/skills.ts` | Skill HTTP API 路由 |
| `kun/src/loop/agent-loop.ts` | Agent Loop 中 Skill 集成点 |
| `kun/src/server/runtime-factory.ts` | 运行时工厂 Skill 装配 |
| `kun/src/delegation/child-agent-executor.ts` | 子 Agent Skill 继承 |
| `kun/src/loop/context-compactor.ts` | 上下文压缩 Skill 保留 |
| `kun/tests/skill-runtime.test.ts` | Skill 运行时测试 |

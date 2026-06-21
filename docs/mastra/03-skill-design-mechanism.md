# Mastra Skill 设计机制

> 基于 `mastra` 项目源码深度分析，涵盖 Skill 的定义、发现、加载、执行全生命周期。

## 1. 概述

Mastra 的 Skill 系统遵循 [Agent Skills 规范](https://agentskills.io/specification)，是一种**知识注入**机制——通过文件系统组织的结构化文档，在 Agent 对话时自动注入到系统提示词或按需加载。Skill 与 Tool 是互补概念：Skill 是知识内容，Tool 是可执行动作。

### 1.1 核心设计理念

| 概念 | 说明 |
|------|------|
| **Skill = 知识** | 文档、流程指南、参考资料的集合 |
| **Tool = 动作** | Agent 可调用的可执行函数 |
| **Skill 不是 Tool** | 系统提示词明确禁止 Agent 将 Skill 名当作 Tool 名调用 |
| **Skill 暴露为 Tool** | `skill`/`skill_search`/`skill_read` 三个工具用于操作 Skill 内容 |

---

## 2. Skill 定义规范

### 2.1 目录结构

每个 Skill 是一个包含 `SKILL.md` 文件的目录：

```
my-skill/
├── SKILL.md          # 核心文件：YAML 前置元数据 + Markdown 指令
├── references/       # 参考文档（可选）
│   ├── api.md
│   └── guide.md
├── scripts/          # 可执行脚本（可选）
│   └── setup.sh
└── assets/           # 图片等二进制资源（可选）
    └── diagram.png
```

### 2.2 SKILL.md 格式

**YAML 前置元数据（必填字段）**：

```yaml
---
name: my-skill              # 1-64 字符，小写字母+连字符
description: My skill desc  # 1-1024 字符
license: MIT                # 可选
compatibility: ">=1.0.0"    # 可选
user-invocable: true        # 可选，默认 true
metadata:                   # 可选，任意键值对
  category: code-generation
---
```

**验证规则** (`packages/core/src/workspace/skills/schemas.ts`)：

| 字段 | 约束 |
|------|------|
| `name` | 1-64字符，`^[a-z0-9-]+$`，不能以 `-` 开头/结尾，不能有连续 `-`，必须与目录名一致 |
| `description` | 1-1024 字符，非空 |
| `license` | 可选，最长 500 字符 |
| `compatibility` | 可选，最长 500 字符 |
| `user-invocable` | 可选布尔值，控制是否在 `/skills` 命令中列出 |
| `metadata` | 可选，任意 key-value |

**Markdown 正文**：`---` 分隔符之后的所有内容，作为 Agent 的指令文本（instructions）。

### 2.3 资源限制

```typescript
// vico/core/src/workspace/skills/schemas.ts
const SKILL_LIMITS = {
  MAX_INSTRUCTION_TOKENS: 5000,   // 警告阈值
  MAX_INSTRUCTION_LINES: 500,     // 警告阈值
  MAX_NAME_LENGTH: 64,
  MAX_DESCRIPTION_LENGTH: 1024,
  MAX_COMPATIBILITY_LENGTH: 500,
};
```

### 2.4 TypeScript 类型定义

```typescript
// vico/core/src/workspace/skills/types.ts

// 前置元数据
interface SkillMetadata {
  name: string;
  path: string;           // 目录路径
  description: string;
  license?: string;
  compatibility?: string;
  userInvocable: boolean; // 默认 true
  metadata?: Record<string, string>;
}

// 完整 Skill 对象
interface Skill extends SkillMetadata {
  instructions: string;   // Markdown 正文
  source: ContentSource;  // 来源类型
  references: string[];   // references/ 下的文件列表
  scripts: string[];      // scripts/ 下的文件列表
  assets: string[];       // assets/ 下的文件列表
}

// 来源类型
type ContentSource = 'external'  // node_modules/ 中的
                   | 'local'     // 项目目录中的
                   | 'managed';  // .mastra/skills/ 中的
```

---

## 3. Skill 发现与加载机制

### 3.1 核心类：`WorkspaceSkillsImpl`

文件：`packages/core/src/workspace/skills/workspace-skills.ts`

这是 Skill 系统的中枢，负责发现、加载、缓存和刷新所有 Skill。

### 3.2 路径配置

在 `Workspace` 上配置 Skill 路径，支持静态和动态两种方式：

```typescript
// 静态路径数组
workspace.skills = ['./skills/my-skill', './skills/another-skill'];

// 动态函数（运行时根据上下文决定路径）
workspace.skills = (ctx) => {
  if (ctx.user.tier === 'enterprise') {
    return ['./shared/skills', './enterprise/skills'];
  }
  return ['./shared/skills', './basic/skills'];
};
```

支持的路径格式：
- **目录路径**：扫描子目录中的 `SKILL.md`
- **文件路径**：直接指向 `SKILL.md`
- **Glob 模式**：如 `./**/skills`，自动展开匹配

### 3.3 来源自动检测

系统根据路径特征自动判断 `ContentSource`：

```
路径包含 node_modules/  → external
路径包含 .mastra/skills → managed
其他                     → local
```

### 3.4 发现流程 (`discoverSkills()`)

```
1. 解析所有路径（静态数组或动态函数返回值）
                    ↓
2. 对每个路径，确定 ContentSource
                    ↓
3. 路径类型判断
   ├── Glob 模式 → resolvePathPattern() 展开匹配
   │               → 并行处理匹配的文件/目录
   ├── 目录路径  → 扫描子目录查找 SKILL.md
   │               → 同时检测自身是否为直接 Skill
   └── 文件路径  → 直接加载 SKILL.md
                    ↓
4. 解析每个 SKILL.md（gray-matter 解析 frontmatter）
                    ↓
5. 验证元数据（validateSkillMetadata）
                    ↓
6. 按 name 分组缓存到 Map<string, InternalSkill[]>
   （同名 Skill 可从多个来源存在）
```

### 3.5 缓存与刷新 (`maybeRefresh()`)

```typescript
// 缓存刷新策略
class WorkspaceSkillsImpl {
  private _discoveryMtime: number;    // 上次发现时间戳
  private _cachedSkills: Map<string, InternalSkill[]>;
  
  async maybeRefresh(): Promise<void> {
    const now = Date.now();
    // 冷却期保护：避免频繁刷新（默认 2s）
    if (now - this._discoveryMtime < COOLDOWN_MS) return;
    
    // 检查目录 mtime 是否发生变化
    if (await this.shouldRefresh()) {
      await this.discoverSkills();
      this._discoveryMtime = now;
    }
  }
}
```

**刷新策略**：
- 比较目录 `mtime` 时间戳
- Glob 目录每 5 秒重新扫描
- 可选 `checkSkillFileMtime` 模式检测原地编辑
- 冷却期（2s）避免冗余检查

### 3.6 SkillSource 抽象层

文件：`packages/core/src/workspace/skills/skill-source.ts`

抽象的 `SkillSource` 接口，使 Skill 可以从不同存储后端加载：

```typescript
interface SkillSource {
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ mtimeMs: number; isDirectory: boolean }>;
  readFile(path: string): Promise<string>;
  readdir(path: string): Promise<string[]>;
  realpath?(path: string): Promise<string>;
}
```

**四种实现**：

| 实现 | 文件 | 说明 |
|------|------|------|
| `LocalSkillSource` | `local-skill-source.ts` | 使用 Node.js `fs/promises` 读取本地文件系统，支持符号链接检测 |
| `VersionedSkillSource` | `versioned-skill-source.ts` | 从内容寻址的 Blob Store 读取，使用 `SkillVersionTree` 清单 |
| `CompositeVersionedSkillSource` | `composite-versioned-skill-source.ts` | 组合多个版本化 Skill 树为虚拟目录，可选回退到文件系统 |

---

## 4. Skill 与 Agent 集成

### 4.1 两种集成模式

#### 模式 A：SkillsProcessor（提前注入）

文件：`packages/core/src/processors/processors/skills.ts`

- **时机**：在对话第一步（`stepNumber === 0`）
- **动作**：
  1. 调用 `skills.maybeRefresh()` 检查过期
  2. 将所有可用 Skill 的元数据注入系统提示词

**支持三种格式**（通过 `AgentConfig.skillsFormat` 配置）：

**XML 格式（默认）**：
```xml
<available_skills>
  <skill>
    <name>my-skill</name>
    <description>Description here</description>
    <location>/path/to/skill</location>
    <source>local</source>
  </skill>
</available_skills>
```

**JSON 格式**：
```json
[
  {
    "name": "my-skill",
    "description": "Description here",
    "location": "/path/to/skill",
    "source": "local"
  }
]
```

**Markdown 格式**：
```markdown
# Available Skills
- **my-skill**: Description here (location: /path/to/skill, source: local)
```

**系统指令注入**：
```
Skills are NOT tools. Do not call skill names directly as tool names. 
To use a skill, call the `skill` tool with the skill name as the 'name' parameter.
```

#### 模式 B：SkillSearchProcessor（按需发现）

文件：`packages/core/src/processors/processors/skill-search.ts`

适用于 Skill 数量较多的场景，提供**按需发现**而非全部注入：

- **元工具**（代替 `skill`/`skill_search`）：
  - `search_skills` — 按关键词搜索相关 Skill
  - `load_skill` — 加载指定 Skill 的完整指令
- **保留工具**：`skill_read` 始终可用
- **状态管理**：线程作用域 + TTL 清理（默认 1 小时）
- 当此处理器存在时，提前注入模式下的 `skill` 和 `skill_search` 工具被抑制

### 4.2 处理器优先级

Agent 在处理请求时，处理器按以下优先级应用（`agent.ts`）：

```
1. Memory 处理器
2. Workspace 处理器
3. Skills 处理器
4. Channels 处理器
5. Browser 处理器
6. 用户自定义处理器
```

### 4.3 自动注册

当 `workspace.skills` 非空时，Agent 自动创建 `SkillsProcessor`：

```typescript
// agent.ts: getSkillsProcessors()
function getSkillsProcessors(workspace): Processor[] {
  if (!workspace.skills) return [];
  
  if (workspace.skills.length > SKILL_SEARCH_THRESHOLD) {
    return [new SkillSearchProcessor(workspace.skills)];
  }
  return [new SkillsProcessor(workspace.skills, config.skillsFormat)];
}
```

---

## 5. Skill 工具系统

### 5.1 三个核心工具

文件：`packages/core/src/workspace/skills/tools.ts`

由 `createSkillTools(workspace.skills)` 创建，自动添加到 Agent 可用工具列表中。

#### `skill` — 激活/加载 Skill

```typescript
{
  name: 'skill',
  description: 'Load a skill by name or path to get its full instructions',
  parameters: {
    name: string,  // Skill 名称或路径
    // 可选：指定来源
    source?: 'local' | 'external' | 'managed'
  },
  requireApproval: false,  // 无需审批
  execute: async ({ name, source }) => {
    const skill = skills.get(name, source);
    return {
      instructions: skill.instructions,
      references: skill.references,
      scripts: skill.scripts,
      assets: skill.assets,
    };
  }
}
```

**无状态设计**：不跟踪激活状态，只将指令加载到对话历史中。

#### `skill_search` — 搜索 Skill 内容

```typescript
{
  name: 'skill_search',
  description: 'Search across all skill content',
  parameters: {
    query: string,       // 搜索关键词
    mode?: 'bm25' | 'vector' | 'hybrid',  // 搜索模式
    limit?: number,      // 返回结果数
  },
  requireApproval: false,
  execute: async ({ query, mode, limit }) => {
    // BM25 + 向量 + 混合搜索
    return { results: [{ snippet, score, skillName, filePath }] };
  }
}
```

#### `skill_read` — 读取 Skill 文件

```typescript
{
  name: 'skill_read',
  description: 'Read a file from a skill',
  parameters: {
    skillName: string,   // Skill 名称
    filePath: string,    // 文件相对路径（在 references/scripts/assets/ 下）
    startLine?: number,  // 可选行范围
    endLine?: number,
  },
  requireApproval: false,
  execute: async ({ skillName, filePath, startLine, endLine }) => {
    return { content: fileContents };
  }
}
```

### 5.2 关键设计决策

- **无需审批**：所有 Skill 工具 `requireApproval: false`
- **不暴露为直接 Tool 名**：Skill 名称不作为独立 Tool，避免混淆
- **搜索索引**：Skill 内容建立 BM25 + 向量搜索索引

---

## 6. Skill 版本管理与发布

### 6.1 发布流程

文件：`packages/core/src/workspace/skills/publish.ts`

```typescript
// 收集 Skill 文件并哈希
function collectSkillForPublish(
  source: SkillSource, 
  skillPath: string
): { tree: SkillVersionTree; blobs: BlobEntry[] }

// 执行发布
async function publishSkillFromSource(
  source: SkillSource, 
  skillPath: string, 
  blobStore: BlobStore
): Promise<SkillVersion>

// 从文件列表解析快照（用于发布 + 注册表安装）
function parseSkillSnapshotFromFiles(
  files: Record<string, string>
): ParsedSkill
```

**发布流程**：
1. 遍历 Skill 目录，哈希所有文件
2. 构建 `SkillVersionTree` 清单（内容寻址的文件树）
3. 收集 Blob 条目
4. 存储到 Blob Store
5. 二进制文件用 base64 编码

### 6.2 存储层

文件：`packages/core/src/storage/domains/skills/`

```typescript
// 薄记录：管理元数据
interface StorageSkillType {
  id: string;
  status: 'draft' | 'published' | 'archived';
  activeVersionId: string;
  authorId: string;
  visibility: string;
  favoriteCount: number;
}

// 版本行：内容数据
interface StorageSkillSnapshotType {
  name: string;
  description: string;
  instructions: string;
  license?: string;
  references: string[];
  scripts: string[];
  assets: string[];
  files: Record<string, string>;
  tree: SkillVersionTree;
}

// 抽象基类
abstract class SkillsStorage extends VersionedStorageDomain {
  abstract create(data): Promise<StorageSkillType>;
  abstract get(id: string): Promise<StorageSkillType>;
  abstract list(): Promise<StorageSkillType[]>;
  abstract update(id, data): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract createVersion(skillId, snapshot): Promise<string>;
}
```

**具体实现**：
- `FilesystemSkillsStorage` — 文件系统存储
- `InmemorySkillsStorage` — 内存存储（测试用）

---

## 7. Skill 生态与分发

### 7.1 注册表集成

Skill 可以从 [skills.sh](https://skills.sh) 注册表安装：

```typescript
// Agent Builder 配置
new MastraEditor({
  builder: {
    registries: {
      skillsSh: { enabled: true }  // 启用 skills.sh 注册表
    }
  }
})
```

安装的 Skill 存储为 `StoredSkill` 记录。

### 7.2 CLI 安装

```bash
# 在项目初始化时
npx skills add mastra-ai/skills --agent agentName1 agentName2 -y
```

对应的 CLI 代码：`packages/cli/src/commands/init/skills-install.ts`

### 7.3 Mastracode 命令

在 Mastracode TUI 中：

| 命令 | 功能 |
|------|------|
| `/skills` | 列出所有用户可调用的 Skill（user-invocable: true） |
| `/skill/<name>` | 激活指定 Skill，发送其指令给 Agent |

扫描目录：
```
.mastracode/skills/
.claude/skills/
.agents/skills/
~/.mastracode/skills/
~/.claude/skills/
~/.agents/skills/
```

### 7.4 用户可调用过滤

```typescript
// mastracode/src/tui/commands/skill-filters.ts
function filterUserInvocableSkills(skills: Skill[]): Skill[] {
  return skills.filter(s => s.userInvocable !== false);
}
```

---

## 8. 架构总结

```
                        Workspace.skills: [path1, path2, ...]
                                       |
                                       v
                        WorkspaceSkillsImpl (发现引擎)
                        ├── 扫描目录查找 SKILL.md
                        ├── 解析 frontmatter + 正文
                        ├── 发现 references/ scripts/ assets/
                        ├── 建立搜索索引 (BM25/向量/混合)
                        ├── 缓存结果，支持过期刷新
                        └── SkillSource 抽象层
                             ├── LocalSkillSource (本地文件系统)
                             ├── VersionedSkillSource (Blob Store)
                             └── CompositeVersionedSkillSource (混合)
                                       |
                                       v
                        Agent 自动集成
                        ├── SkillsProcessor
                        │   └── 注入 <available_skills> 到系统提示词
                        │       支持 XML/JSON/Markdown 三种格式
                        ├── SkillSearchProcessor (可选替代)
                        │   └── search_skills + load_skill 元工具
                        └── createSkillTools()
                             ├── skill (加载)
                             ├── skill_search (搜索)
                             └── skill_read (读取文件)
                                       |
                                       v
                        发布/分发
                        ├── publishSkillFromSource() → Blob Store
                        ├── skills.sh 注册表集成
                        └── CLI 安装 + Mastracode 命令
```

### 关键设计要点

1. **Skill 与 Tool 分离**：Skill 是知识，Tool 是动作，两者互不混淆
2. **文件系统即数据库**：以 `SKILL.md` + 目录结构为单元，简单可靠
3. **多层抽象**：`SkillSource` 接口解耦存储后端，支持本地/版本化/混合
4. **懒加载 + 缓存**：`maybeRefresh()` 按需增量刷新，减少文件系统开销
5. **自动集成**：Agent 检测到 Skill 配置后自动注册处理器和工具，零代码接入
6. **搜索能力**：内建 BM25 + 向量 + 混合搜索，支持按需发现
7. **版本管理**：内容寻址存储 + 版本树，支持草稿/发布/归档生命周期

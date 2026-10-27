# tools/skills 装配迁入 @vico/boot —— agent 收敛为纯编排

## 背景

`packages/agent/src/create-agent.ts`（L4 编排层）内嵌了 `buildTools` / `buildSkills` 两个装配函数：
它们跨域拼装 `@vico/tool`（内置）、`@vico/bash-tool`（coding）、`@vico/fs-tool`（文件系统）、
`@vico/memory`（语义记忆工具）、`@vico/skill`（skill 工具 / 扫描）。这属于 L5 装配层职责，
却落在编排层 —— 直接后果是 `@vico/boot` 的 `skills-provider.ts` 反向 `import { buildSkills } from '@vico/agent'`，
与 `boot-startup-layer.md` 定下的「value 边 L0→L5 单向流动、无运行时环」分层相悖。

## 目标

- 把 `buildTools` / `buildSkills` 迁入 `@vico/boot`（新增 `src/lib/build-tools.ts` / `build-skills.ts`）。
- `@vico/agent` 的 `createAgent` 收敛为纯编排：只接受已装配好的 `Tool[]` / `Skill[]`，不再自行组装。
- 删除已 `@deprecated` 且无引用的 `Vico` 类（其「一键装配」职责已由 `@vico/boot` 承接，且依赖被迁出的 `buildSkills`）。

## 关键变更

### 装配逻辑 → boot

- 新增 `packages/boot/src/lib/build-tools.ts`：迁入 `buildTools`（现为 `BuildToolsOptions` 对象入参），
  从 `@vico/tool` / `@vico/bash-tool` / `@vico/fs-tool` / `@vico/fs` / `@vico/memory` / `@vico/skill` 直接装配。
- 新增 `packages/boot/src/lib/build-skills.ts`：迁入 `buildSkills` + `SkillOptions` / `SkillSettings`，
  以及原 `agent/src/utils.ts` 里的 `COMPATIBLE_SKILL_ROOTS` / `collectSkillDirs`（模块内私有）。
- `skills-provider.ts` 改为从本地 `../lib/build-skills.js` 引入 `buildSkills`，不再反向依赖 agent。
- `@vico/boot` 新增依赖 `@vico/bash-tool`、`@vico/fs-tool`、`@vico/tool`。

### agent 收敛为纯编排

- `AgentConfig.tools`：`ToolOptions` → `Tool[]`（含义：已组装的完整工具集）。
- `AgentConfig.skills`：`SkillOptions` → `Skill[]`（含义：已加载的 Skill 列表）。
- `createAgent` 内改为 `config.tools ?? []` / `config.skills ?? []` 直接透传。
- 删除 `buildTools` / `buildSkills` / `SkillSettings` / `SkillOptions` / `ToolSetting` / `ToolOptions`，
  以及 `vico.ts`（`Vico` 类）和 `index.ts` 中对应导出。
- agent 依赖移除 `@vico/bash-tool`、`@vico/fs-tool`（迁移后 agent 内已无引用）。

### server 显式组装

- `vico/server/src/lib/utils.ts` 的 `createIfAbsent` 改为：
  `const skills = config.skills ?? await c.resolve('skills')`，
  `const tools = config.tools ?? buildTools({ filesystem: c.get('filesystem'), extraTools: [c.get('weatherTool')], semanticMemory: c.get('memory').semantic, skills })`，
  再把 `skills` / `tools` 透传给 `createAgent`。
- `vico/server/src/lib/agent-factory.ts` 无需改动（已传 `skills: Skill[]`，未传 `tools`）。

## 语义变化与注意点

- `AgentConfig.tools` 语义从「额外工具（createAgent 自动补默认）」变为「完整工具集」。
  生产消费点仅 `createIfAbsent` 一处，已同步改为显式 `buildTools` 组装。
- `packages/agent/src/tools/delegate-tool.ts`（`createDelegateTool`，仓库内无引用）仍写 `tools: []`，
  迁移后子 agent 不再隐式获得默认工具集。属死路径，本次不改；若后续启用需显式传入只读工具子集。

## 验证

- `pnpm --filter @vico/boot typecheck` 通过
- `pnpm --filter @vico/boot test` 通过（12 用例）
- `pnpm --filter @vico/agent typecheck` 通过
- `vico/server` `npx tsc --noEmit` 通过
- 运行期由用户验证：`pnpm dev` 启动后聊天，确认内置工具 + weather + skill 工具仍可用

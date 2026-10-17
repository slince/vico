# @vico/skill

Skill 插件系统：加载、注册与工具。

基于文件系统的 Skill 加载（manifest + prompt + tools），提供注册表与一组让 Agent 加载/检索/读取/执行 Skill 的工具。

## 主要导出

- `SkillLoader` / `Skill` — 端口与数据模型
- `createFSSkillLoader` — 文件系统 Skill 加载器
- `SkillRegistry` — Skill 注册表
- 工具 — `createSkillLoadTool` / `createSkillSearchTool` / `createSkillReadTool` / `createSkillExecuteTool` / `createSkillTools`

## 依赖

| 依赖 | 用途 |
|------|------|
| `@vico/tool` | 工具框架 |
| `gray-matter` | 解析 markdown front-matter |
| `zod` | schema 校验 |

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)

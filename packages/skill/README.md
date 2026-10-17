# @vico/skill

Skill 插件系统：加载、注册与工具。

基于文件系统的 Skill 加载（SKILL.md front-matter），提供注册表与一组让 Agent 加载/检索/读取/执行 Skill 的工具。

## 快速使用

```ts
import { createFSSkillLoader, SkillRegistry } from '@vico/skill';

// 扫描目录下所有 SKILL.md（含一级子目录）
const loader = createFSSkillLoader(['./skills', '~/.vico/skills']);
const skills = await loader();

// 注册并检索
const registry = new SkillRegistry(skills);
const skill = registry.get('my-skill');
const matches = registry.search('关键词', 10);
```

## 相关文档

- [@vico/core 拆分方案](../core/SPLIT-PLAN.md)

# @vico/core

Vico 聚合壳：re-export 全部 13 个领域子包，消费方零改动入口。

新代码建议直接依赖细粒度子包（如 `@vico/tool` / `@vico/memory`），本包仅作为统一入口保留。

## 依赖

re-export 以下全部子包：

`@vico/agent` / `@vico/context` / `@vico/tool` / `@vico/checkpoint` / `@vico/skill` / `@vico/compaction` / `@vico/memory` / `@vico/model` / `@vico/thread` / `@vico/stream` / `@vico/rag` / `@vico/types` / `@vico/utils` / `@vico/events`

## 相关文档

- [拆分方案](SPLIT-PLAN.md)
- [依赖图](DEPENDENCIES.md)

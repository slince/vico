# builtin 工具拆分：browser-tool 独立 + resolveWorkspacePath 下沉

## 背景

`@vico/tool` 原为「工具框架 + 全部内置工具」的混合包。为消除消费方为单个工具拖入整个包及其重依赖的问题，已陆续拆出 `@vico/fs-tool`（文件系统）、`@vico/bash-tool`（bash/pwsh）。本次完成剩余 builtin 的归位：

- `@vico/browser-tool`：browser_navigate / browser_snapshot / browser_click 三个 Playwright 工具独立成包。Playwright 保持可选依赖（懒加载，未安装时返回安装提示），不装 Playwright 的消费方不再被迫关心它。
- `resolveWorkspacePath` 下沉 `@vico/utils`：它是纯路径函数，却让 fs-tool / bash-tool / server 为它依赖 `@vico/tool` 的 builtin 桶；`@vico/utils` 是更底层、无内部依赖的基础库，归它更合适。
- todo / web_fetch / ask_user 留 `@vico/tool`：三者轻量、无重依赖，且 ask_user 本质是审批协议的一部分，保留在框架包避免碎片化。

## 拆分后 `@vico/tool` 剩余

`@vico/tool` 收敛为「框架 + 3 个基础工具」：

- 框架：createTool / ToolExecutor / StormBreaker / 审批策略 / Tool 类型
- 基础工具：todo_write / web_fetch / ask_user

## 依赖方向

`@vico/utils` 为无内部依赖的基础库，`resolveWorkspacePath` 下沉后各工具包不再为它依赖 `@vico/tool`：

```
@vico/browser-tool ──┐
@vico/fs-tool ────────┼──→ @vico/tool ──→ @vico/thread / @vico/types
@vico/bash-tool ──────┘
   │        │
   └────────┴────→ @vico/utils（resolveWorkspacePath）
```

`vico/server` 同时依赖 `@vico/tool`（框架）与 `@vico/utils`（路径解析）。

## 消费方改动

- `@vico/boot`：`build-tools.ts` 新增 `browserTools` 装配，`package.json` 加 `@vico/browser-tool`。
- `@vico/fs-tool` / `@vico/bash-tool`：`resolveWorkspacePath` 改从 `@vico/utils` 导入，`package.json` 加 `@vico/utils`。
- `@vico/server`：`api/fs.ts` 改从 `@vico/utils` 导入，`package.json` 加 `@vico/utils`。

## 验证

`@vico/tool` / `@vico/utils` / `@vico/browser-tool` / `@vico/fs-tool` / `@vico/bash-tool` / `@vico/boot` / `@vico/server` 的 `tsc --noEmit` 全部通过。

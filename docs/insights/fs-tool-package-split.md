# fs-tool 拆分为 @vico/fs-tool 独立包

## 背景

文件系统工具原内嵌于 `@vico/tool` 的 `src/builtin/filesystem/`，与工具框架（`createTool` / `ToolExecutor` / 审批策略）混在同一包。任何只复用文件系统工具的消费方都要拖入整个 `@vico/tool`（含浏览器 / web fetch / todo / ask_user 全部内置工具与 `@vico/thread` / `@vico/types` 依赖）。

拆出 `@vico/fs-tool` 后，文件系统工具可独立复用，仅依赖 `@vico/tool` 框架原语（`createTool`、`ToolCallContext`、`resolveWorkspacePath`）、`@vico/fs` 文件系统抽象层与 `zod`。

## 改动清单

| 项 | 值 |
|----|----|
| 新包 | `packages/fs-tool` → `@vico/fs-tool` |
| 导出 | `readTool` / `writeTool` / `editTool` / `globTool` / `grepTool`、`createReadTool` 等工厂、`filesystemTools` |
| 依赖 | `@vico/tool`（框架原语）、`@vico/fs`（文件系统端口）、`zod` |

- `@vico/tool`：移除 `filesystemTools` 与 5 个 filesystem 工具（工厂 + 默认实例）导出；`basicTools` / `baseBuiltinTools` / `resolveWorkspacePath` 保留；移除 `@vico/fs` 依赖。
- `@vico/agent`：`create-agent.ts` 的 `filesystemTools` 改从 `@vico/fs-tool` 导入，`package.json` 新增 `workspace:*` 依赖。
- `@vico/tool` / `@vico/bash-tool` 的 README 示例同步更新 `filesystemTools` 的导入来源。

## 依赖方向

`@vico/fs-tool` → `@vico/fs` / `@vico/tool`，无环。

## 验证

- `pnpm --filter @vico/fs-tool typecheck`
- `pnpm --filter @vico/tool typecheck`
- `pnpm --filter @vico/agent typecheck`
- `pnpm --filter @vico/boot typecheck`
- `pnpm --filter @vico/server exec tsc --noEmit`

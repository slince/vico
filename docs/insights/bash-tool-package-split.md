# bash-tool 拆分为 @vico/bash-tool 独立包

## 背景

`bash` 工具原内嵌于 `@vico/tool` 的 `src/builtin/coding/bash-tool.ts`，与工具框架（`createTool` / `ToolExecutor` / 审批策略）混在同一包。任何只复用 bash 工具的消费方都要拖入整个 `@vico/tool`（含 filesystem / basic 全部内置工具与 `@vico/thread` / `@vico/types` 依赖）。

拆出 `@vico/bash-tool` 后，bash 工具可独立复用，仅依赖 `@vico/tool` 框架原语（`createTool`、`ToolCallContext`、`resolveWorkspacePath`）与 `zod`。

## 改动清单

| 项 | 值 |
|----|----|
| 新包 | `packages/bash-tool` → `@vico/bash-tool` |
| 导出 | `createBashTool` / `createPwshTool` / `createShellTool`、`bashTool` / `pwshTool` |
| 依赖 | `@vico/bash`（命令解析/执行）、`@vico/tool`（框架原语）、`@vico/utils`、`zod` |

- `@vico/tool`：移除 `bashTool` 与 `codingTools` 导出；依赖 bash 的废弃导出 `fileBuiltinTools` / `coreBuiltinTools` 一并移除，`baseBuiltinTools` 保留。
- `@vico/agent`：`create-agent.ts` 的 `codingTools` 改从 `@vico/bash-tool` 导入，`package.json` 新增 `workspace:*` 依赖。

## shell 工具选择

`createShellTool()` 按主机环境选择单个 shell 工具，替代原 `shellTools` 数组（`boot` 的 `buildTools` 直接调用）：

- **Windows 且找不到 Git Bash**（`resolveGitBashPath` 探测常见安装位置与 PATH）→ `pwsh`；
- **其余情况**（非 Windows，或 Windows 装有 Git Bash）→ `bash`，Windows 上的 bash 经 Git Bash 的 `bash.exe` 派发（`LocalCommandExecutor`），而非 POSIX 的 `/bin/bash`。

## 依赖方向

`@vico/bash-tool` → `@vico/bash` / `@vico/tool` / `@vico/utils`，无环。

## 验证

- `pnpm --filter @vico/bash-tool typecheck`
- `pnpm --filter @vico/agent typecheck`
- `pnpm --filter @vico/tool typecheck`

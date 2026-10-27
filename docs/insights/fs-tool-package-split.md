# fs-tool 拆分为 @vico/fs-tool 独立包

## 背景

文件系统工具原内嵌于 `@vico/tool` 的 `src/builtin/filesystem/`，与工具框架（`createTool` / `ToolExecutor` / 审批策略）混在同一包。任何只复用文件系统工具的消费方都要拖入整个 `@vico/tool`（含浏览器 / web fetch / todo / ask_user 全部内置工具与 `@vico/thread` / `@vico/types` 依赖）。

拆出 `@vico/fs-tool` 后，文件系统工具可独立复用，仅依赖 `@vico/tool` 框架原语（`createTool`、`ToolCallContext`、`resolveWorkspacePath`）、`zod`，以及两块实现基座：`@vico/fs` 文件系统抽象层（read/write/edit）与 `@vscode/ripgrep` 打包二进制（glob/grep，见下文）。

## 改动清单

| 项 | 值 |
|----|----|
| 新包 | `packages/fs-tool` → `@vico/fs-tool` |
| 导出 | `readTool` / `writeTool` / `editTool` / `globTool` / `grepTool`、`createReadTool` 等工厂、`filesystemTools` |
| 依赖 | `@vico/tool`（框架原语）、`@vico/fs`（read/write/edit 文件系统端口）、`@vscode/ripgrep`（glob/grep 二进制）、`diff`（edit 的 unified diff）、`zod` |

- `@vico/tool`：移除 `filesystemTools` 与 5 个 filesystem 工具（工厂 + 默认实例）导出；`basicTools` / `baseBuiltinTools` / `resolveWorkspacePath` 保留；移除 `@vico/fs` 依赖。
- `@vico/agent`：`create-agent.ts` 的 `filesystemTools` 改从 `@vico/fs-tool` 导入，`package.json` 新增 `workspace:*` 依赖。
- `@vico/tool` / `@vico/bash-tool` 的 README 示例同步更新 `filesystemTools` 的导入来源。

## glob / grep 基于 ripgrep 实现

`globTool` 与 `grepTool` 不再手写目录遍历 / glob 转正则，改为 spawn `@vscode/ripgrep` 打包的 `rg` 二进制（`src/ripgrep.ts` 的 `runRipgrep` + `toWorkdirRelative`），参考 `deepseek-harness` 的 `tool-fs-search`。

- **glob**：`rg --files --glob=<pattern> --sort=modified --no-ignore --hidden <VCS/node_modules 排除> -- <path>`，按修改时间倒序，输出绝对路径经 `toWorkdirRelative` 转 workspace 相对路径。
- **grep**：`rg --json --regexp=<pattern> [--ignore-case] [--glob=<glob>] -- <path>`，解析 NDJSON 只取 `match` 记录（`path.text` / `line_number` / `lines.text`），格式化为 `相对路径:行号:行内容`。
- **退出码约定**：`rg` 无匹配退出码 `1`，`runRipgrep` 将其归一为 `{ noMatches: true }`，其余非零码抛错。
- **argv 安全**：模型输入统一走 `--regexp=` / `--glob=` / `--`（`execFile` 无 shell 层），避免 leading-dash 值被解析为 flag；`--no-config` 阻断 `RIPGREP_CONFIG_PATH` 注入。
- **变更点**：`createGlobTool` / `createGrepTool` 不再接收 `fs` 参数（spawn 实现，与 `@vico/fs` 无关）；`grep` 移除原 `context` 参数——参考实现约定用 `read` 补上下文。

## edit 的 unified diff 基于 `diff` 包

`editTool` 原本手写 `generateDiff`（逐行前缀/后缀对比，中间插入/删除会错位），改为 `diff`（jsdiff）的 `createPatch`：`createPatch(path, before, after, undefined, undefined, { context: 3, headerOptions: FILE_HEADERS_ONLY })`。参考 `deepseek-harness` 的 `tool-fs`（其 `computeHunkDiffs` 用 `structuredPatch`）。

- **context 3**：与参考实现的 `DIFF_CONTEXT = 3` 一致。
- **`FILE_HEADERS_ONLY`**：去掉 jsdiff 默认 `Index:`/`===` git 风格头，输出干净的 `---/+++/@@` unified diff。
- **不传 oldHeader/newHeader**：避免 jsdiff 默认拼时间戳导致输出非确定。

## edit 简化为单一字面量替换

`editTool` 原本一个工具塞了 4 种模式（字面量替换 / 批量 `edits[]` / 行号范围编辑 / 行号插入），10 个参数 + 手写 if/else 判模式。行号编辑对 LLM 天然脆弱（行号漂移、模型数行不准），且全仓库无任何代码、eval 使用；deepseek 与 Claude Code 均已放弃行号编辑。现砍到只剩字面量替换：`{ path, oldText, newText, replaceAll? }`，一次一处或 `replaceAll` 全替换，「插入」用锚点字面量替换表达。前端 `vico/web/src/tools/filesystem.tool.ts` 的平行定义同步收敛。

替换核心对齐 deepseek `tool-fs` 的 `applyLiteralEdit`（`fs-local/src/fsio.ts`）：

- **纯字面量**：`countOccurrences`（`indexOf` 循环非重叠计数）+ `content.split(oldNorm).join(newNorm)`，去掉正则转义。
- **`replaceAll` 语义**：默认 false（多处命中抛歧义错误），true 全替换。
- **LF 归一化**：读入后 `normalizeLineEndings`（`\r\n`→`\n`）统一到 LF 基准做匹配与 diff；`detectLineEndings` 采样判断原文件 CRLF/LF，写回前 `restoreLineEndings` 还原，CRLF 文件不再整文件误报变更。
- **空 oldText**：显式拒绝（对齐 deepseek 的 `FS_EDIT_NOT_FOUND`）。
- 未照搬并发/版本 CAS 与 `FS_*` 结构化错误码——那依赖 fs 服务层的 per-target 锁与版本概念，本工具暂不具备。

## 依赖方向

`@vico/fs-tool` → `@vico/fs`（read/write/edit） / `@vico/tool` / `@vscode/ripgrep` / `diff`，无环。

## 验证

- `pnpm --filter @vico/fs-tool typecheck`
- `pnpm --filter @vico/tool typecheck`
- `pnpm --filter @vico/agent typecheck`
- `pnpm --filter @vico/boot typecheck`
- `pnpm --filter @vico/server exec tsc --noEmit`

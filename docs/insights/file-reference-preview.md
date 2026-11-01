# 文件引用预览升级

让 LLM 输出涉及文件时明确标记文件地址，前端渲染后把文件引用转成可点击链接，点击打开会话右侧的文件预览面板。

## 背景

- 聊天区助手文本由 `MarkdownText`（`@assistant-ui/react-markdown`）渲染，工具调用由各 `ToolUIs/*-ui.tsx` 渲染。
- 右侧文件预览面板（`ChatSidebar`）已存在，`fileExplorerStore.openFile(threadId, filePath, fileName)` 负责创建/激活文件 tab 并拉取内容。
- 此前工具卡片里的 `result.path` 是纯文本，助手正文里的文件路径也无任何交互，二者都没有和预览面板打通。

## 方案三层

### 1. 服务端：提示词要求模型标记文件

`packages/context/src/system-prompt-processor.ts` 在 workspace section 追加指令：

> Whenever you mention a file that you read, wrote, or edited in your reply, cite it by its path relative to the working directory and wrap it in single backticks (e.g. `src/index.ts`). Do not prepend the full absolute path.

模型天然用反引号包路径，此指令只做强化，前端不依赖模型严格遵守也能识别。

### 2. 前端：路径启发式 + 渲染成可点击链接

- `web/src/lib/file-link.ts`：`isFilePathCandidate()` 判定「像路径」——`./`/`../`/`/`/`~` 前缀、含 `/`/`\` 分隔符、或已知扩展名结尾的裸文件名；`isFileLinkHref()` 排除外部协议/锚点；`basename()` 取路径末段。
- `web/src/components/assistant-ui/elements/file-link.tsx`：`FileLink` 组件（文件图标 + 路径），无 threadId 时退化为纯文本。
- `web/src/components/assistant-ui/file-reference-context.tsx`：`FileReferenceContext`，向消息渲染树注入 `threadId` 与 `openFileReference(path)`。
- `web/src/components/assistant-ui/elements/markdown-text.tsx`：inline `code` 命中路径 → `FileLink`；`a` 的非外部协议 href 命中路径 → `FileLink`。

### 3. 点击 → 打开右侧预览面板

`openFileReference` 内部：

```ts
store.setFileExplorerOpen(true);                    // 强制展开右侧面板
store.openFile(threadId, path, basename(path));     // 创建/激活文件 tab 并拉取内容
```

`fileExplorerStore` 新增 `setFileExplorerOpen(open)`（此前只有 `toggleFileExplorer`）。

### 4. 工具卡片路径一并可点

`read-ui` / `write-ui` / `edit-ui` 的 `result.path`、`glob-ui` 的 `result.files` 复用 `FileLink`（结构化、无歧义，覆盖面最大）。

## 关键决策

| 决策点 | 结论 |
| --- | --- |
| 文件识别策略 | 反引号路径启发式 + markdown 链接（模型友好、流式友好、偶有误判可控） |
| 工具卡片范围 | 一并做（结构化路径最可靠） |
| 点击行为 | 展开面板 + 激活文件 tab（文件不存在时预览面板展示错误） |

## 数据流

```
LLM 输出 `` `src/index.ts` `` (或 `[x](src/index.ts)`)
  → MarkdownTextPrimitive 解析为 inlineCode / link 节点
  → code/a 组件命中 isFilePathCandidate
  → FileLink（FileReferenceContext 提供 threadId）
  → onClick → openFileReference → store.setFileExplorerOpen(true) + store.openFile
  → GET /api/v1/threads/:id/fs/read?path=...（服务端 resolveWorkspacePath 相对 workspace 解析）
  → ChatSidebar 渲染 FileContentView
```

## 注意事项

- `threadId` 为 null（新会话尚未创建 / 非聊天场景如 AgentDetail）时，`FileLink` 退化为纯文本，不报错。
- 文件路径可能是相对或绝对路径，服务端 `resolveWorkspacePath` 均支持。
- 误判（如 `cd foo/bar`）只会多出一个可点击样式，点击后文件不存在时预览面板展示错误，风险可控。

# 文件系统抽象层 `@vico/fs`

## 背景

项目对本地文件的操作此前散落在各包，直接 `import { readFileSync } from 'node:fs'` / `node:fs/promises`，与存储层的抽象化方向（`@vico/checkpoint` → `checkpoint-libsql`/`checkpoint-mysql` 等「端口 + 适配器」）不一致。抽出统一的**文件系统抽象层**，把「读写文件 / 列目录 / 建目录 / stat / unlink」收敛到单一端口，默认只实现 `LocalFilesystem`（本地磁盘），将来可平滑扩展 S3 / 内存等适配器。

核心交付是**抽象层本身**（`packages/fs` → `@vico/fs`）；迁移只是把现有调用点接到该端口上。

## 抽象设计

```
packages/fs/
├── package.json          # name @vico/fs，无 runtime 依赖；test / typecheck 脚本
├── tsconfig.json         # ES2024 / NodeNext / strict / declaration
├── README.md
└── src/
    ├── filesystem.ts         # FileStat / DirEntry 类型 + 抽象类 Filesystem
    ├── local-filesystem.ts   # LocalFilesystem（node:fs/promises 实现）
    └── index.ts              # barrel + 默认单例 localFilesystem
```

- **异步-only**：与 `CheckpointStore` / `MemoryStore` 及 libsql/mysql/chroma 适配器保持一致的 async 风格。
- **二进制用 `Uint8Array`**（不绑定 Node `Buffer`），未来 S3 适配器可返回同型。
- `readTextFile` / `readFile` 拆开，避免 `encoding` 字符串重载的类型尴尬。
- 覆盖当前项目全部 fs 操作面，不引入用不到的泛化（不做 `rm -r`、`rename`、`chmod` 等）。

```ts
export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
  mtimeMs: number;
}

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

export abstract class Filesystem {
  abstract readFile(path: string): Promise<Uint8Array>;
  abstract readTextFile(path: string): Promise<string>;
  abstract writeFile(path: string, data: string | Uint8Array): Promise<void>;
  abstract readDir(path: string): Promise<DirEntry[]>;
  abstract mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
  abstract stat(path: string): Promise<FileStat>;
  abstract unlink(path: string): Promise<void>;
}
```

默认单例（对齐项目单例习惯）：`export const localFilesystem: Filesystem = new LocalFilesystem();`

## 落地方式

统一模式：在**已有工厂/构造器 seam** 上加可选 `fs: Filesystem = localFilesystem` 参数，默认走单例，未来可注入替代实现。同步调用点就地改 async（工具 `execute`、loader 本就返回 Promise）。

- `packages/skill`：`fs-skill-loader.ts` 的 `loadSkillFromDir` / `loadSkillsFromDirs` / `createFSSkillLoader` 增 `fs` 参数；`skill-read.ts` 的 `createSkillReadTool(manager, fs = localFilesystem)`。
- `packages/fs-tool`（原 `packages/tool/src/builtin/filesystem/`，后拆分为独立包）：`read` / `write` / `edit` 改为 `createXTool(fs: Filesystem)`（fs 必填，由装配层注入）；glob/grep 走 ripgrep 不依赖 fs。
- `packages/rag`：`text` / `markdown` / `csv` / `html` 解析器 `readFile` → `localFilesystem.readTextFile`；`pdf` / `docx` → `Buffer.from(await localFilesystem.readFile(...))`。
- `packages/memory`：`FileSemanticMemoryOptions` 增可选 `fs`，内部改走 `this.fs.*`。

## 依赖方向

`@vico/fs` 无 runtime 依赖；`skill` / `fs-tool` / `rag` / `memory` 各自新增 `@vico/fs: workspace:*`（`@vico/tool` 在 filesystem 工具迁出后已移除该依赖）。

## 暂未迁移（说明原因）

- `packages/di/src/container.ts` 的 `readConfigFile`（`readFileSync`）：避免把 `Container.load()` 同步 API 改成 async 的破坏性变更。
- `vico/server/src/db/init-libsql.ts` 的 `mkdirSync`：位于同步 `getClient()` 内。

## 后续可选（本轮未纳入）

- `vico/server/src/api/fs.ts`（约 350 行同步文件浏览器，重写为 async 属另一块工作）。
- `vico/server` 的 `rag-manager` / `knowledge-manager` / `storage-manager` 中其余本地 fs 调用。

## 验证

- `pnpm --filter @vico/fs test`（LocalFilesystem 读写 roundtrip / mkdir+exists+readDir / stat+unlink，3/3 通过）。
- `pnpm --filter @vico/fs --filter @vico/skill --filter @vico/tool --filter @vico/rag --filter @vico/memory --filter @vico/agent --filter @vico/boot --filter @vico/server typecheck`（全绿）。

> 注：`@vico/fs` 等库包只有 `typecheck`（`tsc --noEmit`），无 `build` 脚本——与 `checkpoint` / `tool` / `skill` 等兄弟包一致，库包以 TS 源码经 `exports: "./src/index.ts"` 被消费。

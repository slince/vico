# @vico/di

轻量、类型安全的依赖注入容器。除了解析依赖，同时解决「构建对象时需要读取配置」的问题。

## 特性

- **工厂 Provider**：依赖与配置在同一个工厂函数里汇合，支持按配置条件构建（如 s3/local 切实现）
- **类型安全的 TokenMap**：声明 token → 实例类型映射后，`register` 校验工厂返回类型、`resolve` 推断返回类型
- **作用域**：`singleton`（默认，全容器唯一）/ `transient`（每次新建）
- **异步工厂**：`resolveAsync` 解析返回 Promise 的工厂，并发调用共享同一 pending Promise（工厂只执行一次）
- **循环依赖检测**：同步/异步解析统一检测

## 用法

```ts
import { createContainer } from '@vico/di';

interface AppConfig { storage: { type: 'local' | 's3'; root: string } }
interface Tokens {
  db: Db;
  storage: Storage;
}

const container = createContainer<AppConfig, Tokens>(config);

container
  .register('db', ({ config }) => initDb(config.database))
  .register('storage', ({ config, resolve }) =>
    config.storage.type === 's3'
      ? new S3Storage(config.storage, resolve('db'))
      : new LocalStorage(config.storage, resolve('db')),
  );

const storage = container.resolve('storage'); // 类型为 Storage
```

异步工厂用 `resolveAsync`：

```ts
container.register('embedder', async ({ config, resolve }) => {
  const db = resolve('db');
  return loadEmbedder(config.rag.embedder);
});
const embedder = await container.resolveAsync('embedder');
```

## API

| 方法 | 说明 |
|------|------|
| `createContainer(config?)` | 创建容器，注入只读配置 |
| `container.register(token, factory, options?)` | 注册工厂 Provider，`options.scope` 默认 `singleton` |
| `container.registerValue(token, value)` | 注册已构建好的实例 |
| `container.resolve(token)` | 同步解析（异步工厂会抛错） |
| `container.resolveAsync(token)` | 异步解析，兼容同步工厂 |
| `container.has(token)` | 是否已注册 |

## 命令

```bash
pnpm --filter @vico/di typecheck   # 类型检查
pnpm --filter @vico/di test        # 运行单测
```

# @vico/di

轻量、类型安全的依赖注入容器。除了解析依赖，同时解决「构建对象时需要读取配置」与「配置定义加载验证」两个问题。

## 特性

- **工厂 Provider**：依赖与配置在同一个工厂函数里汇合，支持按配置条件构建（如 s3/local 切实现）
- **类型安全的 TokenMap**：声明 token → 实例类型映射后，`register` 校验工厂返回类型、`get` 推断返回类型
- **配置定义加载**：`registerConfig` 声明 zod schema，`load` 从 yaml/json 读取并用 schema 验证，`getConfig` 取用
- **作用域**：`singleton`（默认，全容器唯一）/ `transient`（每次新建）
- **异步工厂**：`resolve` 解析返回 Promise 的工厂，并发调用共享同一 pending Promise（工厂只执行一次）
- **循环依赖检测**：同步/异步解析统一检测
- **服务标签**：注册时 `options.tags` 打标签，`getByTag` / `resolveByTag` 按标签批量取用
- **Service Provider**：按领域组织组装逻辑，`register`（绑定）+ `boot`（初始化）两阶段，支持异步

## 依赖注入

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
  .register('storage', ({ config, get }) =>
    config.storage.type === 's3'
      ? new S3Storage(config.storage, get('db'))
      : new LocalStorage(config.storage, get('db')),
  );

const storage = container.get('storage'); // 类型为 Storage
```

异步工厂用 `resolve`：

```ts
container.register('embedder', async ({ config, get }) => {
  const db = get('db');
  return loadEmbedder(config.rag.embedder);
});
const embedder = await container.resolve('embedder');
```

## 服务标签

注册时通过 `options.tags` 给服务打标签，之后按标签批量取用（常用于遍历同一接口的所有实现）：

```ts
interface Svc { start(): void }
interface Tokens { a: Svc; b: Svc; c: Svc }

container
  .register('a', () => new SvcA(), { tags: ['store'] })
  .register('b', () => new SvcB(), { tags: ['store'] })
  .register('c', () => new SvcC());   // 不打标签

const stores = container.getByTag<Svc>('store');        // [SvcA, SvcB]，按注册顺序
const asyncStores = await container.resolveByTag<Svc>('store');  // 兼容异步工厂
```

- `getByTag` 同步解析（命中异步工厂会抛错），`resolveByTag` 兼容异步工厂
- 结果按注册顺序返回；作用域语义与 `get` / `resolve` 一致（transient 每次新建）
- 泛型 `<Svc>` 指定实例类型，默认 `unknown`

## 配置定义加载

```ts
import { z } from 'zod';

const memorySchema = z.object({
  stm_window: z.number(),
  ltm_auto_extract: z.boolean(),
});

interface ConfigKeys { memory: typeof memorySchema }

const container = createContainer<AppConfig, Tokens, ConfigKeys>(config);

container
  .registerConfig('memory', memorySchema)
  .load('server.config.yaml')     // 支持 .yaml/.yml/.json，可多次 load 多个文件
  .load('custom.json');

const memory = container.getConfig('memory'); // 类型为 { stm_window: number; ltm_auto_extract: boolean }
```

- 文件顶层是「配置名 → 值」的对象，`load` 后按已注册的 key 抽取对应段并验证
- 验证失败、文件缺失、顶层非对象、`getConfig` 缺 key 均抛错
- 多次加载同名 key，后加载覆盖先加载（覆盖后重新验证）
- 工厂内也可读取：`ctx.getConfig('memory')`

## Service Provider

按领域把组装逻辑组织成 provider：`register` 只做绑定，`boot`（可选）在所有 provider 注册完成后统一初始化。

```ts
const storageProvider = {
  register(c) {
    c.registerConfig('storage', storageSchema).load('storage.yaml');
    c.register('db', ({ config }) => initDb(config.database));
    c.register('storage', ({ config, get }) =>
      config.storage.type === 's3'
        ? new S3Storage(config.storage, get('db'))
        : new LocalStorage(config.storage, get('db')),
    );
  },
  async boot(c) {
    await c.get('db').migrate();   // 全部绑定完成后再统一初始化
  },
};

await container.bootstrap([storageProvider, memoryProvider]);
```

- `register` 与 `boot` 均可返回 Promise，由 `bootstrap` 依次等待
- `register` 阶段只做绑定（register / registerConfig / load），副作用与初始化放 `boot`

## API

| 方法 | 说明 |
|------|------|
| `createContainer(config?)` | 创建容器，注入只读配置 |
| `container.register(token, factory, options?)` | 注册工厂 Provider，`options.scope` 默认 `singleton`，`options.tags` 打服务标签 |
| `container.registerValue(token, value, options?)` | 注册已构建好的实例 |
| `container.get(token)` | 同步解析（异步工厂会抛错） |
| `container.resolve(token)` | 异步解析，兼容同步工厂 |
| `container.getByTag(tag)` | 同步解析打了该标签的所有服务，按注册顺序 |
| `container.resolveByTag(tag)` | 异步解析打了该标签的所有服务，兼容异步工厂 |
| `container.has(token)` | 是否已注册 |
| `container.registerConfig(key, schema)` | 声明配置段及其 zod schema |
| `container.load(path)` | 加载 yaml/json 配置文件，对已注册 key 立即验证 |
| `container.getConfig(key)` | 获取已验证的配置段 |
| `container.bootstrap(providers)` | 依序执行各 provider 的 `register` 再 `boot` |

## 命令

```bash
pnpm --filter @vico/di typecheck   # 类型检查
pnpm --filter @vico/di test        # 运行单测
```

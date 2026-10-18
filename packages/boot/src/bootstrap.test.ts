// @vico/boot - 启动层测试（默认配置加载、用户覆盖、两阶段时序、真实装配）

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentRuntime } from '@vico/agent';
import { CheckpointPurge, MemoryCheckpointStore } from '@vico/checkpoint';
import { MysqlCheckpointStore } from '@vico/checkpoint-mysql';
import { MemoryStore } from '@vico/memory';
import { InMemoryVectorStore } from '@vico/rag';
import { ChromaVectorStore } from '@vico/rag-chroma';
import { LibSQLVectorStore } from '@vico/rag-libsql';
import { InMemoryThreadStore } from '@vico/thread';
import { LibSqlThreadStore } from '@vico/thread-libsql';
import { createVicoContainer, vicoProviders } from './bootstrap.js';
import type { VicoServiceProvider } from './tokens.js';

/** 写一个临时配置文件并返回其路径 */
function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vico-boot-'));
  const file = join(dir, 'config.yaml');
  writeFileSync(file, content, 'utf-8');
  return file;
}

describe('createVicoContainer', () => {
  it('加载内置默认配置', async () => {
    const c = await createVicoContainer();
    expect(c.getConfig('agent').max_cached).toBe(50);
    expect(c.getConfig('logger').level).toBe('info');
    expect(c.getConfig('skills').scan_paths).toEqual([]);
    expect(c.getConfig('rag').embedder).toBe('openai/text-embedding-3-small');
    expect(c.getConfig('memory').stm_window).toBe(20);
    expect(c.getConfig('tool').timeout_ms).toBe(30000);
    expect(c.getConfig('checkpoint').ttl_days).toBe(30);
    expect(c.getConfig('storage').thread).toBe('memory');
    expect(c.getConfig('storage').checkpoint).toBe('memory');
    expect(c.getConfig('storage').vector).toBe('memory');
    expect(c.getConfig('storage').db_service).toBe('db');
    expect(c.getConfig('storage').client_service).toBe('client');
  });

  it('用户配置整段覆盖默认配置', async () => {
    const file = writeTempConfig(
      'rag:\n  chunk_size: 256\n  chunk_overlap: 32\n  retrieval_top_k: 3\n  embedder: local\n',
    );
    const c = await createVicoContainer({ configPath: file });
    expect(c.getConfig('rag').chunk_size).toBe(256);
    expect(c.getConfig('rag').embedder).toBe('local');
    // 未被覆盖的段仍来自默认配置
    expect(c.getConfig('memory').stm_window).toBe(20);
    rmSync(join(file, '..'), { recursive: true, force: true });
  });

  it('段内缺失字段由 schema 默认值兜底', async () => {
    const file = writeTempConfig('workspace:\n  base_path: /tmp/ws\n');
    const c = await createVicoContainer({ configPath: file });
    expect(c.getConfig('workspace').base_path).toBe('/tmp/ws');
    expect(c.getConfig('workspace').contained).toBe(true);
    expect(c.getConfig('workspace').isolation).toBe('none');
    rmSync(join(file, '..'), { recursive: true, force: true });
  });
});

describe('bootstrap 两阶段时序', () => {
  it('所有 provider 先 register 再 boot', async () => {
    const events: string[] = [];
    const mk = (name: string): VicoServiceProvider => ({
      register() {
        events.push(`${name}:register`);
      },
      boot() {
        events.push(`${name}:boot`);
      },
    });
    const c = await createVicoContainer({
      setup: async (container) => {
        for (const provider of [mk('a'), mk('b'), mk('c')]) {
          await container.registerProvider(provider);
        }
      },
    });
    await c.boot();
    expect(events).toEqual(['a:register', 'b:register', 'c:register', 'a:boot', 'b:boot', 'c:boot']);
  });
});

describe('providers 真实装配', () => {
  it('createVicoContainer + boot 后可 resolve 出 framework 核心依赖', async () => {
    const c = await createVicoContainer();
    await c.boot();
    expect(c.resolve('thread')).toBeInstanceOf(InMemoryThreadStore);
    expect(c.resolve('checkpointStore')).toBeInstanceOf(MemoryCheckpointStore);
    expect(c.resolve('checkpointPurge')).toBeInstanceOf(CheckpointPurge);
    expect(c.resolve('logger')).toBeTruthy();
    expect(c.resolve('vectorStore')).toBeInstanceOf(InMemoryVectorStore);
    expect(c.resolve('memory')).toBeInstanceOf(MemoryStore);
    expect(c.resolve('agentRuntime')).toBeInstanceOf(AgentRuntime);
    expect(c.resolve('events')).toBeTruthy();
  });

  it('skills 异步扫描（默认空路径 → 空列表）', async () => {
    const c = await createVicoContainer();
    await c.boot();
    const skills = await c.resolveAsync('skills');
    expect(skills).toEqual([]);
  });

  it('embedder 配置为 none 时禁用 episodic', async () => {
    const file = writeTempConfig('rag:\n  embedder: none\n');
    const c = await createVicoContainer({ configPath: file });
    await c.boot();
    expect(c.resolve('embedder')).toBeUndefined();
    expect(c.resolve('memory').episodic).toBeUndefined();
    rmSync(join(file, '..'), { recursive: true, force: true });
  });

  it('默认 embedder 启用 episodic', async () => {
    const c = await createVicoContainer();
    await c.boot();
    expect(c.resolve('embedder')).toBeTruthy();
    expect(c.resolve('memory').episodic).toBeTruthy();
  });

  it('storage 配置驱动后端选择（libsql / mysql / chroma）', async () => {
    const file = writeTempConfig(
      'storage:\n  thread: libsql\n  checkpoint: mysql\n  vector: chroma\n',
    );
    const c = await createVicoContainer({
      configPath: file,
      setup: (container) => {
        // 持久化后端所需的连接由使用方注入（测试注入占位对象即可，构造阶段不校验）
        container.register('db', () => ({}));
        container.register('client', () => ({}));
      },
    });

    await c.boot();
    expect(c.resolve('thread')).toBeInstanceOf(LibSqlThreadStore);
    expect(c.resolve('checkpointStore')).toBeInstanceOf(MysqlCheckpointStore);
    expect(c.resolve('vectorStore')).toBeInstanceOf(ChromaVectorStore);

    rmSync(join(file, '..'), { recursive: true, force: true });
  });

  it('storage 配置为 libsql 向量后端时选择 LibSQLVectorStore', async () => {
    const file = writeTempConfig('storage:\n  vector: libsql\n');
    const c = await createVicoContainer({
      configPath: file,
      setup: (container) => {
        container.register('client', () => ({}));
      },
    });

    await c.boot();
    expect(c.resolve('vectorStore')).toBeInstanceOf(LibSQLVectorStore);

    rmSync(join(file, '..'), { recursive: true, force: true });
  });

  it('storage 的 db_service 驱动连接 token 名（未注册对应 token 时按配置名报错）', async () => {
    const file = writeTempConfig('storage:\n  thread: libsql\n  db_service: mydb\n');
    const c = await createVicoContainer({
      configPath: file,
      setup: (container) => {
        // 注册默认 'db'，但配置指向 'mydb'：provider 应去 resolve 'mydb' 而非硬编码 'db'
        container.register('db', () => ({}));
      },
    });

    await c.boot();
    expect(() => c.resolve('thread')).toThrow(/Dependency not registered: mydb/);

    rmSync(join(file, '..'), { recursive: true, force: true });
  });
});

describe('vicoProviders', () => {
  it('按声明顺序导出领域 provider', () => {
    expect(vicoProviders).toHaveLength(5);
  });
});

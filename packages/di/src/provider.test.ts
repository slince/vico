import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContainer } from './container.js';

interface Tokens {
  a: string;
  b: string;
}

const memorySchema = z.object({
  stm_window: z.number(),
  ltm_auto_extract: z.boolean(),
});

interface ConfigKeys {
  memory: typeof memorySchema;
}

/** 在临时目录写入配置文件，执行异步断言后清理 */
async function withTempFile(content: string, fn: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'vico-di-'));
  const path = join(dir, 'config.yaml');
  writeFileSync(path, content);
  try {
    await fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('ServiceProvider / bootstrap', () => {
  it('依次执行所有 register 后再依次 boot', async () => {
    const order: string[] = [];
    const container = createContainer<undefined, Tokens>();

    await container.bootstrap([
      {
        register(c) {
          order.push('r1');
          c.register('a', () => 'A');
        },
        boot() {
          order.push('b1');
        },
      },
      {
        register(c) {
          order.push('r2');
          c.register('b', () => 'B');
        },
        boot() {
          order.push('b2');
        },
      },
    ]);

    expect(order).toEqual(['r1', 'r2', 'b1', 'b2']);
    expect(container.resolve('a')).toBe('A');
    expect(container.resolve('b')).toBe('B');
  });

  it('boot 阶段可解析 register 阶段注册的服务', async () => {
    const container = createContainer<undefined, Tokens>();
    let resolved = '';

    await container.bootstrap([
      {
        register(c) {
          c.register('a', () => 'hello');
        },
        boot(c) {
          resolved = c.resolve('a');
        },
      },
    ]);

    expect(resolved).toBe('hello');
  });

  it('register 与 boot 返回 Promise 时被依次等待', async () => {
    const order: string[] = [];
    const container = createContainer<undefined, Tokens>();

    await container.bootstrap([
      {
        async register(c) {
          await Promise.resolve();
          order.push('r1');
          c.register('a', () => 'A');
        },
        async boot() {
          await Promise.resolve();
          order.push('b1');
        },
      },
    ]);

    expect(order).toEqual(['r1', 'b1']);
  });

  it('boot 是可选钩子', async () => {
    const container = createContainer<undefined, Tokens>();

    await container.bootstrap([
      {
        register(c) {
          c.register('a', () => 'A');
        },
      },
    ]);

    expect(container.resolve('a')).toBe('A');
  });

  it('provider 内可 load 配置并在 boot 中 getConfig', async () => {
    await withTempFile('memory:\n  stm_window: 11\n  ltm_auto_extract: true\n', async (path) => {
      const container = createContainer<undefined, Tokens, ConfigKeys>();
      let windowSize = 0;

      await container.bootstrap([
        {
          register(c) {
            c.registerConfig('memory', memorySchema).load(path);
          },
          boot(c) {
            windowSize = c.getConfig('memory').stm_window;
          },
        },
      ]);

      expect(windowSize).toBe(11);
    });
  });
});

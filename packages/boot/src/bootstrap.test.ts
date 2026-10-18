// @vico/boot - 启动层测试（默认配置加载、用户覆盖、provider 两阶段时序）

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapVico, createVicoContainer, vicoProviders } from './bootstrap.js';
import type { VicoServiceProvider } from './tokens.js';

/** 写一个临时配置文件并返回其路径 */
function writeTempConfig(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vico-boot-'));
  const file = join(dir, 'config.yaml');
  writeFileSync(file, content, 'utf-8');
  return file;
}

describe('createVicoContainer', () => {
  it('加载内置默认配置', () => {
    const c = createVicoContainer();
    expect(c.getConfig('skills').scan_paths).toEqual([]);
    expect(c.getConfig('rag').embedder).toBe('openai/text-embedding-3-small');
    expect(c.getConfig('memory').stm_window).toBe(20);
    expect(c.getConfig('tool').timeout_ms).toBe(30000);
    expect(c.getConfig('checkpoint').ttl_days).toBe(30);
  });

  it('用户配置整段覆盖默认配置', () => {
    const file = writeTempConfig(
      'rag:\n  chunk_size: 256\n  chunk_overlap: 32\n  retrieval_top_k: 3\n  embedder: local\n',
    );
    const c = createVicoContainer({ configPath: file });
    expect(c.getConfig('rag').chunk_size).toBe(256);
    expect(c.getConfig('rag').embedder).toBe('local');
    // 未被覆盖的段仍来自默认配置
    expect(c.getConfig('memory').stm_window).toBe(20);
    rmSync(join(file, '..'), { recursive: true, force: true });
  });

  it('段内缺失字段由 schema 默认值兜底', () => {
    const file = writeTempConfig('workspace:\n  base_path: /tmp/ws\n');
    const c = createVicoContainer({ configPath: file });
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
    const c = createVicoContainer();
    await c.bootstrap([mk('a'), mk('b'), mk('c')]);
    expect(events).toEqual(['a:register', 'b:register', 'c:register', 'a:boot', 'b:boot', 'c:boot']);
  });

  it('骨架 providers 可无副作用启动', async () => {
    const c = await bootstrapVico();
    // 骨架阶段未绑定真实实现，resolve 未注册 token 应抛错
    expect(c.has('agentRuntime')).toBe(false);
  });
});

describe('vicoProviders', () => {
  it('按声明顺序导出领域 provider', () => {
    expect(vicoProviders).toHaveLength(3);
  });
});

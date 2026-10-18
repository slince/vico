import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createContainer } from './container.js';

const memorySchema = z.object({
  stm_window: z.number(),
  ltm_auto_extract: z.boolean(),
});

interface ConfigKeys {
  memory: typeof memorySchema;
}

/** 配置加载测试无需依赖解析，用宽松 TokenMap */
function configContainer() {
  return createContainer<undefined, Record<string, unknown>, ConfigKeys>();
}

/** 在临时目录写入配置文件，执行断言后清理 */
function withTempFile(
  content: string,
  filename: string,
  fn: (path: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), 'vico-di-'));
  const path = join(dir, filename);
  writeFileSync(path, content);
  try {
    fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('配置加载', () => {
  it('load 加载 yaml 并按 schema 验证，getConfig 返回验证后的值', () => {
    withTempFile('memory:\n  stm_window: 20\n  ltm_auto_extract: true\n', 'config.yaml', (path) => {
      const container = configContainer();
      container.registerConfig('memory', memorySchema).load(path);

      expect(container.getConfig('memory')).toEqual({
        stm_window: 20,
        ltm_auto_extract: true,
      });
    });
  });

  it('load 加载 json 文件', () => {
    withTempFile(
      JSON.stringify({ memory: { stm_window: 5, ltm_auto_extract: false } }),
      'config.json',
      (path) => {
        const container = configContainer();
        container.registerConfig('memory', memorySchema).load(path);

        expect(container.getConfig('memory').stm_window).toBe(5);
      },
    );
  });

  it('加载多个文件，后加载覆盖先加载', () => {
    withTempFile('memory:\n  stm_window: 1\n  ltm_auto_extract: true\n', 'a.yaml', (pathA) => {
      withTempFile('memory:\n  stm_window: 99\n  ltm_auto_extract: false\n', 'b.yaml', (pathB) => {
        const container = configContainer();
        container.registerConfig('memory', memorySchema).load(pathA).load(pathB);

        expect(container.getConfig('memory').stm_window).toBe(99);
      });
    });
  });

  it('验证失败时抛错，报错含 key 与来源文件', () => {
    withTempFile('memory:\n  stm_window: "not-a-number"\n  ltm_auto_extract: true\n', 'bad.yaml', (path) => {
      const container = configContainer();
      container.registerConfig('memory', memorySchema);

      expect(() => container.load(path)).toThrow(/memory/);
      expect(() => container.load(path)).toThrow(/bad\.yaml/);
    });
  });

  it('已注册但文件未提供对应 key 时 getConfig 报错', () => {
    withTempFile('other:\n  x: 1\n', 'config.yaml', (path) => {
      const container = configContainer();
      container.registerConfig('memory', memorySchema).load(path);

      expect(() => container.getConfig('memory')).toThrow(/not provided by any loaded file/);
    });
  });

  it('getConfig 未注册的 key 报错', () => {
    const container = configContainer();
    expect(() => container.getConfig('memory')).toThrow(/Config not registered/);
  });

  it('先 load 后 registerConfig，注册时补验证并可用', () => {
    withTempFile('memory:\n  stm_window: 30\n  ltm_auto_extract: true\n', 'config.yaml', (path) => {
      const container = configContainer();
      container.load(path).registerConfig('memory', memorySchema);

      expect(container.getConfig('memory').stm_window).toBe(30);
    });
  });

  it('先 load 后 registerConfig，值非法时注册即抛错', () => {
    withTempFile('memory:\n  stm_window: "bad"\n', 'config.yaml', (path) => {
      const container = configContainer();
      container.load(path);

      expect(() => container.registerConfig('memory', memorySchema)).toThrow(/validation failed/);
    });
  });

  it('工厂内通过 ctx.getConfig 读取配置', () => {
    interface Tokens {
      summary: string;
    }
    withTempFile('memory:\n  stm_window: 42\n  ltm_auto_extract: true\n', 'config.yaml', (path) => {
      const container = createContainer<undefined, Tokens, ConfigKeys>();
      container
        .registerConfig('memory', memorySchema)
        .load(path)
        .register('summary', ({ getConfig }) => `window=${getConfig('memory').stm_window}`);

      expect(container.resolve('summary')).toBe('window=42');
    });
  });

  it('getConfig 返回类型由 schema 推断（编译期 + 运行时）', () => {
    withTempFile('memory:\n  stm_window: 7\n  ltm_auto_extract: true\n', 'config.yaml', (path) => {
      const container = configContainer();
      container.registerConfig('memory', memorySchema).load(path);

      const memory = container.getConfig('memory');
      const window: number = memory.stm_window; // 编译期断言：number
      const auto: boolean = memory.ltm_auto_extract; // 编译期断言：boolean
      expect(typeof window).toBe('number');
      expect(typeof auto).toBe('boolean');
    });
  });

  it('文件不存在时报错', () => {
    const container = configContainer();
    expect(() => container.load('/no/such/file.yaml')).toThrow(/Failed to read config file/);
  });

  it('顶层非对象时报错', () => {
    withTempFile('- a\n- b\n', 'list.yaml', (path) => {
      const container = configContainer();
      expect(() => container.load(path)).toThrow(/top level must be an object/);
    });
  });
});

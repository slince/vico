import { describe, expect, it } from 'vitest';
import { createContainer } from './container.js';

interface Db {
  name: string;
}

interface Storage {
  root: string;
}

interface Tokens {
  db: Db;
  storage: Storage;
}

interface AppConfig {
  storage: { root: string };
}

describe('createContainer', () => {
  it('注册并解析单例，多次 resolve 返回同一实例', () => {
    const container = createContainer<undefined, Tokens>();
    let built = 0;
    container.register('db', () => {
      built += 1;
      return { name: 'sqlite' };
    });

    const a = container.resolve('db');
    const b = container.resolve('db');

    expect(a).toBe(b);
    expect(built).toBe(1);
  });

  it('transient 作用域每次解析新建实例', () => {
    const container = createContainer<undefined, Tokens>();
    container.register('db', () => ({ name: 'sqlite' }), { scope: 'transient' });

    expect(container.resolve('db')).not.toBe(container.resolve('db'));
  });

  it('工厂里通过 resolve 注入其他依赖', () => {
    const container = createContainer<undefined, Tokens>();
    container.register('db', () => ({ name: 'sqlite' }));
    container.register('storage', ({ resolve }) => ({ root: `/data/${resolve('db').name}` }));

    expect(container.resolve('storage').root).toBe('/data/sqlite');
  });

  it('工厂里读取注入的配置切片做条件构建', () => {
    const container = createContainer<AppConfig, Tokens>({ storage: { root: '/var/lib' } });
    container.register('storage', ({ config }) => ({ root: config.storage.root }));

    expect(container.resolve('storage').root).toBe('/var/lib');
  });

  it('registerValue 注册已构建好的实例', () => {
    const container = createContainer<undefined, Tokens>();
    const prebuilt = { name: 'prebuilt' };
    container.registerValue('db', prebuilt);

    expect(container.resolve('db')).toBe(prebuilt);
  });

  it('未注册的 token 抛错', () => {
    const container = createContainer<undefined, Tokens>();
    expect(() => container.resolve('db')).toThrow(/未注册/);
  });

  it('重复注册同一 token 抛错', () => {
    const container = createContainer<undefined, Tokens>();
    container.register('db', () => ({ name: 'a' }));
    expect(() => container.register('db', () => ({ name: 'b' }))).toThrow(/重复注册/);
  });

  it('检测直接循环依赖', () => {
    interface CycleTokens {
      a: { name: string };
      b: { name: string };
    }
    const container = createContainer<undefined, CycleTokens>();
    container.register('a', ({ resolve }) => ({ name: resolve('b').name }));
    container.register('b', ({ resolve }) => ({ name: resolve('a').name }));

    expect(() => container.resolve('a')).toThrow(/循环依赖/);
  });

  describe('异步工厂', () => {
    it('resolveAsync 解析异步工厂并缓存结果', async () => {
      const container = createContainer<undefined, Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        return { name: 'sqlite' };
      });

      const db = await container.resolveAsync('db');
      expect(db.name).toBe('sqlite');
      expect((await container.resolveAsync('db'))).toBe(db);
      expect(built).toBe(1);
    });

    it('并发 resolveAsync 共享同一 pending Promise，工厂只执行一次', async () => {
      const container = createContainer<undefined, Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        return { name: 'sqlite' };
      });

      const [a, b] = await Promise.all([
        container.resolveAsync('db'),
        container.resolveAsync('db'),
      ]);

      expect(a).toBe(b);
      expect(built).toBe(1);
    });

    it('异步工厂被同步 resolve 时抛错提示', () => {
      const container = createContainer<undefined, Tokens>();
      container.register('db', async () => ({ name: 'sqlite' }));

      expect(() => container.resolve('db')).toThrow(/resolveAsync/);
    });

    it('异步工厂失败后清空缓存，允许下次重试', async () => {
      const container = createContainer<undefined, Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        if (built === 1) throw new Error('boom');
        return { name: 'recovered' };
      });

      await expect(container.resolveAsync('db')).rejects.toThrow('boom');
      await expect(container.resolveAsync('db')).resolves.toEqual({ name: 'recovered' });
      expect(built).toBe(2);
    });
  });
});

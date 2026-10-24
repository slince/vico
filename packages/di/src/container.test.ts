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

describe('createContainer', () => {
  it('注册并解析单例，多次 get 返回同一实例', () => {
    const container = createContainer<Tokens>();
    let built = 0;
    container.register('db', () => {
      built += 1;
      return { name: 'sqlite' };
    });

    const a = container.get('db');
    const b = container.get('db');

    expect(a).toBe(b);
    expect(built).toBe(1);
  });

  it('transient 作用域每次解析新建实例', () => {
    const container = createContainer<Tokens>();
    container.register('db', () => ({ name: 'sqlite' }), { scope: 'transient' });

    expect(container.get('db')).not.toBe(container.get('db'));
  });

  it('工厂里通过 get 注入其他依赖', () => {
    const container = createContainer<Tokens>();
    container.register('db', () => ({ name: 'sqlite' }));
    container.register('storage', ({ get }) => ({ root: `/data/${get('db').name}` }));

    expect(container.get('storage').root).toBe('/data/sqlite');
  });

  it('registerValue 注册已构建好的实例', () => {
    const container = createContainer<Tokens>();
    const prebuilt = { name: 'prebuilt' };
    container.registerValue('db', prebuilt);

    expect(container.get('db')).toBe(prebuilt);
  });

  it('未注册的 token 抛错', () => {
    const container = createContainer<Tokens>();
    expect(() => container.get('db')).toThrow(/not registered/);
  });

  it('重复注册同一 token 抛错', () => {
    const container = createContainer<Tokens>();
    container.register('db', () => ({ name: 'a' }));
    expect(() => container.register('db', () => ({ name: 'b' }))).toThrow(/Duplicate registration/);
  });

  it('检测直接循环依赖', () => {
    interface CycleTokens {
      a: { name: string };
      b: { name: string };
    }
    const container = createContainer<CycleTokens>();
    container.register('a', ({ get }) => ({ name: get('b').name }));
    container.register('b', ({ get }) => ({ name: get('a').name }));

    expect(() => container.get('a')).toThrow(/Circular dependency/);
  });

  describe('异步工厂', () => {
    it('resolve 解析异步工厂并缓存结果', async () => {
      const container = createContainer<Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        return { name: 'sqlite' };
      });

      const db = await container.resolve('db');
      expect(db.name).toBe('sqlite');
      expect((await container.resolve('db'))).toBe(db);
      expect(built).toBe(1);
    });

    it('并发 resolve 共享同一 pending Promise，工厂只执行一次', async () => {
      const container = createContainer<Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        return { name: 'sqlite' };
      });

      const [a, b] = await Promise.all([
        container.resolve('db'),
        container.resolve('db'),
      ]);

      expect(a).toBe(b);
      expect(built).toBe(1);
    });

    it('异步工厂被同步 get 时抛错提示', () => {
      const container = createContainer<Tokens>();
      container.register('db', async () => ({ name: 'sqlite' }));

      expect(() => container.get('db')).toThrow(/resolve/);
    });

    it('异步工厂失败后清空缓存，允许下次重试', async () => {
      const container = createContainer<Tokens>();
      let built = 0;
      container.register('db', async () => {
        built += 1;
        if (built === 1) throw new Error('boom');
        return { name: 'recovered' };
      });

      await expect(container.resolve('db')).rejects.toThrow('boom');
      await expect(container.resolve('db')).resolves.toEqual({ name: 'recovered' });
      expect(built).toBe(2);
    });
  });

  describe('服务标签', () => {
    interface Svc {
      id: string;
    }

    interface TagTokens {
      svcA: Svc;
      svcB: Svc;
      svcC: Svc;
    }

    it('getByTag 按注册顺序返回打了该标签的所有服务', () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', () => ({ id: 'a' }), { tags: ['group'] });
      container.register('svcB', () => ({ id: 'b' }));
      container.register('svcC', () => ({ id: 'c' }), { tags: ['group'] });

      const group = container.getByTag<Svc>('group');
      expect(group.map((s) => s.id)).toEqual(['a', 'c']);
    });

    it('同一服务打多个标签，可被任一标签命中', () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', () => ({ id: 'a' }), { tags: ['group', 'primary'] });

      expect(container.getByTag<Svc>('primary').map((s) => s.id)).toEqual(['a']);
      expect(container.getByTag<Svc>('group').map((s) => s.id)).toEqual(['a']);
    });

    it('无匹配标签返回空数组', () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', () => ({ id: 'a' }), { tags: ['group'] });

      expect(container.getByTag('nonexistent')).toEqual([]);
    });

    it('resolveByTag 支持异步工厂', async () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', async () => ({ id: 'a' }), { tags: ['async'] });

      const list = await container.resolveByTag<Svc>('async');
      expect(list.map((s) => s.id)).toEqual(['a']);
    });

    it('getByTag 命中异步工厂时抛错提示改用 resolveByTag', () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', async () => ({ id: 'a' }), { tags: ['async'] });

      expect(() => container.getByTag('async')).toThrow(/resolve/);
    });

    it('registerValue 也可打标签', () => {
      const container = createContainer<TagTokens>();
      const prebuilt = { id: 'pre' };
      container.registerValue('svcA', prebuilt, { tags: ['pre'] });

      expect(container.getByTag<Svc>('pre')[0]).toBe(prebuilt);
    });

    it('transient 服务每次 getByTag 新建实例', () => {
      const container = createContainer<TagTokens>();
      container.register('svcA', () => ({ id: 'a' }), { tags: ['t'], scope: 'transient' });

      expect(container.getByTag<Svc>('t')[0]).not.toBe(container.getByTag<Svc>('t')[0]);
    });
  });
});

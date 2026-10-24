// @vico/fs - LocalFilesystem 读写 roundtrip 测试
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystem } from './local-filesystem.js';

describe('LocalFilesystem', () => {
  let dir: string;
  let fs: LocalFilesystem;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vico-fs-'));
    fs = new LocalFilesystem();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writeFile + readTextFile roundtrip', async () => {
    const p = join(dir, 'a.txt');
    await fs.writeFile(p, 'hello');
    expect(await fs.readTextFile(p)).toBe('hello');
  });

  it('mkdir recursive + exists + readDir', async () => {
    const sub = join(dir, 'x', 'y');
    await fs.mkdir(sub, { recursive: true });
    await fs.writeFile(join(sub, 'b.md'), 'content');

    expect(await fs.exists(sub)).toBe(true);
    const entries = await fs.readDir(sub);
    expect(entries.map((e) => e.name)).toEqual(['b.md']);
    expect(entries[0].isFile).toBe(true);
    expect(entries[0].isDirectory).toBe(false);
  });

  it('stat + unlink', async () => {
    const p = join(dir, 'c.bin');
    await fs.writeFile(p, new Uint8Array([1, 2, 3]));

    const stat = await fs.stat(p);
    expect(stat.isFile).toBe(true);
    expect(stat.size).toBe(3);

    await fs.unlink(p);
    expect(await fs.exists(p)).toBe(false);
  });
});

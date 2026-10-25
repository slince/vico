import { describe, it, expect } from 'vitest';
import { parseCommand } from './parse.js';

describe('parseCommand', () => {
  it('拆分 && 且无空格 &&ls、合并短 flag、抽取 targets', () => {
    const c = parseCommand('rm -rf /www/xxx &&ls -n');
    expect(c.raw).toBe('rm -rf /www/xxx &&ls -n');
    expect(c.segments).toHaveLength(2);
    expect(c.segments[0]).toMatchObject({
      operator: 'none', command: 'rm', flags: ['-r', '-f'],
      args: ['/www/xxx'], targets: ['/www/xxx'],
    });
    expect(c.segments[1]).toMatchObject({
      operator: 'and', command: 'ls', flags: ['-n'], args: [], targets: [],
    });
  });

  it('|| 记为一个 or 而非两个 pipe', () => {
    const c = parseCommand('a || b');
    expect(c.segments.map((s) => s.operator)).toEqual(['none', 'or']);
  });

  it('; 与 | 分别记 semi / pipe', () => {
    expect(parseCommand('a; b').segments[1].operator).toBe('semi');
    expect(parseCommand('a | b').segments[1].operator).toBe('pipe');
  });

  it('引号内分隔符不拆分', () => {
    const c = parseCommand('echo "a && b"');
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].args).toEqual(['a && b']);
  });

  it('--flag=value 整体保留', () => {
    const c = parseCommand('grep --color=auto x');
    expect(c.segments[0].flags).toEqual(['--color=auto']);
  });

  it('透传 cwd/timeout/env，timeout 缺省 120000', () => {
    expect(parseCommand('pwd').timeout).toBe(120000);
    const c = parseCommand('pwd', { cwd: '/tmp', timeout: 5000, env: { A: '1' } });
    expect(c).toMatchObject({ cwd: '/tmp', timeout: 5000, env: { A: '1' } });
  });

  it('空白命令退化为单段空 command，不抛异常', () => {
    const c = parseCommand('   ');
    expect(c.segments).toHaveLength(1);
    expect(c.segments[0].command).toBe('');
  });

  it('重定向运算符记入 redirects，目标不进 args/targets', () => {
    const c = parseCommand('ls > /tmp/out');
    expect(c.segments[0].targets).toEqual([]);
    expect(c.segments[0].redirects).toEqual([{ operator: '>', target: '/tmp/out' }]);
  });

  it('fd 复制重定向不吞下一运算符', () => {
    const c = parseCommand('cmd 2>&1 > /tmp/out');
    expect(c.segments[0].redirects).toEqual([
      { operator: '2>&1', target: '' },
      { operator: '>', target: '/tmp/out' },
    ]);
    expect(c.segments[0].targets).toEqual([]);
  });

  it('引号内的 > 不当作重定向', () => {
    const c = parseCommand('echo ">"');
    expect(c.segments[0].redirects).toEqual([]);
    expect(c.segments[0].args).toEqual(['>']);
  });
});

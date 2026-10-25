import { describe, it, expect } from 'vitest';
import { parseCommand } from './parse.js';
import { analyzeCommand, COMMAND_REGISTRY } from './analyze.js';

describe('analyzeCommand', () => {
  it('识别 delete 类与目标', () => {
    const a = analyzeCommand(parseCommand('rm -rf /www/xxx && ls -n'));
    expect(a.segments[0]).toMatchObject({ command: 'rm', category: 'delete', risk: 'high', targets: ['/www/xxx'] });
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'delete-command', segmentIndex: 0 }));
  });

  it('路径越界 → path-outside-root（含 .. 与绝对路径，不做文件系统解析）', () => {
    const opts = { pathPolicy: { allowRoots: ['/app'] } };
    for (const raw of ['rm ../etc', 'rm /etc']) {
      const a = analyzeCommand(parseCommand(raw, { cwd: '/app' }), opts);
      expect(a.findings).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'critical' }));
    }
  });

  it('~ 前缀 target 按 home 展开做越界判断', () => {
    const opts = { pathPolicy: { allowRoots: ['/app'] } };
    const a = analyzeCommand(parseCommand('rm ~/.ssh/id_rsa', { cwd: '/app' }), opts);
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'critical' }));
  });

  it('重定向目标越界 → path-outside-root', () => {
    const opts = { pathPolicy: { allowRoots: ['/app'] } };
    const a = analyzeCommand(parseCommand('ls > /etc/passwd', { cwd: '/app' }), opts);
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'path-outside-root', severity: 'critical' }));
  });

  it('命令替换 → command-substitution', () => {
    const a = analyzeCommand(parseCommand('echo $(whoami)'));
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'command-substitution' }));
  });

  it('重定向 → redirection，且目标不进入 targets', () => {
    const c = parseCommand('ls > /tmp/out');
    expect(c.segments[0].targets).toEqual([]);
    const a = analyzeCommand(c);
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'redirection' }));
  });

  it('未注册命令 → unknown-command', () => {
    const a = analyzeCommand(parseCommand('foobar -x'));
    expect(a.findings).toContainEqual(expect.objectContaining({ code: 'unknown-command', severity: 'info' }));
  });

  it('内置注册表：ls=read、curl=network', () => {
    expect(COMMAND_REGISTRY['ls'].category).toBe('read');
    expect(COMMAND_REGISTRY['curl'].category).toBe('network');
  });
});

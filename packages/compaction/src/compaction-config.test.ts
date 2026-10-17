import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPACTION_SETTINGS,
  resolveCompactSpec, resolveSettings, selectCompactableRange,
} from './compaction-config.js';

describe('resolveSettings', () => {
  it('未传时返回默认值', () => {
    expect(resolveSettings(undefined)).toEqual(DEFAULT_COMPACTION_SETTINGS);
  });

  it('retainRatio 与 retainTokens 互斥报错', () => {
    expect(() => resolveSettings({ retainRatio: 0.1, retainTokens: 8000 })).toThrow(/mutually exclusive|互斥/);
  });

  it('retainRatio >= thresholdRatio 报错', () => {
    expect(() => resolveSettings({ thresholdRatio: 0.5, retainRatio: 0.6 })).toThrow(/retainRatio/);
  });

  it('只改 thresholdRatio 不误报 retainRatio 校验', () => {
    expect(() => resolveSettings({ thresholdRatio: 0.1 })).not.toThrow();
  });

  it('summarizationProvider/Model 必须成对设置', () => {
    expect(() => resolveSettings({ summarizationProvider: 'openai' })).toThrow(/summarization/);
  });

  it('默认 maxTokens = headroomTokens', () => {
    expect(resolveSettings({ headroomTokens: 100 }).maxTokens).toBe(100);
  });
});

describe('resolveCompactSpec', () => {
  it('按公式解析预算', () => {
    const spec = resolveCompactSpec(resolveSettings(), 200000, 4096);
    expect(spec.messageBudgetTokens).toBe(200000 - 4096);
    expect(spec.pressureBudgetTokens).toBe(200000 - 4096 - 65536);
    expect(spec.thresholdTokens).toBe(Math.floor(Math.min(200000 * 0.8, 200000 - 4096 - 65536)));
    expect(spec.retainTokens).toBe(Math.floor((200000 - 4096) * 0.16));
    expect(spec.maxTokens).toBe(65536);
  });

  it('显式 retainTokens 覆盖 retainRatio', () => {
    const spec = resolveCompactSpec(resolveSettings({ retainTokens: 8000 }), 200000, 0);
    expect(spec.retainTokens).toBe(8000);
  });

  it('pressureBudgetTokens <= 0 报错', () => {
    expect(() => resolveCompactSpec(resolveSettings(), 60000, 0)).toThrow(/pressure/);
  });
});

describe('selectCompactableRange', () => {
  const turns = [
    { turnId: 't1', tokens: 100 },
    { turnId: 't2', tokens: 200 },
    { turnId: 't3', tokens: 300 },
  ];

  it('从尾部累计到 retainTokens，head = 剩余 turn', () => {
    // retainTokens=350：尾部累计 t3(300)→t2(500)>=350 停在 t2，保留 [t2,t3]，head=[t1]
    const r = selectCompactableRange(turns, 50, 350);
    expect(r!.headTurnIds).toEqual(['t1']);
    expect(r!.headTokens).toBe(50 + 100);
  });

  it('总 token 不足 retainTokens 时返回 null（全部保留）', () => {
    expect(selectCompactableRange(turns, 50, 1000)).toBeNull();
  });

  it('retainTokens=0 时压缩全部 turn（head = 全部）', () => {
    const r = selectCompactableRange(turns, 50, 0);
    expect(r!.headTurnIds).toEqual(['t1', 't2', 't3']);
  });

  it('head 为空时返回 null', () => {
    expect(selectCompactableRange([], 50, 0)).toBeNull();
    // retainTokens 很小但只有一个 turn：tailStart 会落在 0 → null
    expect(selectCompactableRange([{ turnId: 't1', tokens: 100 }], 0, 10)).toBeNull();
  });
});

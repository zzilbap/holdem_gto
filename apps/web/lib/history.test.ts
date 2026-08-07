import { handStringToIndex } from '@holdem/poker-core';
import { DEFAULT_6MAX_100BB } from '@holdem/solver';
import { beforeEach, describe, expect, it } from 'vitest';

import { LocalHistoryRepository, formatRelativeTime } from './history';
import type { Scenario } from './scenario';

// localStorage가 없는 환경(Node)에서 돌리므로 최소한만 흉내 낸다.
const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  },
});

const openScenario: Scenario = { kind: 'open', hero: 'BTN' };
const vsOpenScenario: Scenario = { kind: 'vs-open', hero: 'BB', villain: 'BTN' };

function entryInput(overrides: Partial<Parameters<LocalHistoryRepository['record']>[0]> = {}) {
  return {
    hero: 'BTN' as const,
    scenario: openScenario,
    handIndex: handStringToIndex('AKo'),
    config: DEFAULT_6MAX_100BB,
    summary: '레이즈하세요',
    tone: 'raise',
    ...overrides,
  };
}

describe('조회 기록', () => {
  let repo: LocalHistoryRepository;

  beforeEach(() => {
    store.clear();
    repo = new LocalHistoryRepository();
  });

  it('처음에는 비어 있다', async () => {
    expect(await repo.list()).toEqual([]);
  });

  it('기록을 남긴다', async () => {
    const entries = await repo.record(entryInput());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe('레이즈하세요');
    expect(entries[0]!.pinned).toBe(false);
  });

  it('같은 상황을 다시 보면 쌓이지 않고 갱신된다', async () => {
    await repo.record(entryInput());
    const entries = await repo.record(entryInput({ summary: '주로 레이즈' }));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.summary).toBe('주로 레이즈');
  });

  it('패가 다르면 별개 기록이다', async () => {
    await repo.record(entryInput());
    const entries = await repo.record(entryInput({ handIndex: handStringToIndex('72o') }));
    expect(entries).toHaveLength(2);
  });

  it('상황이 다르면 별개 기록이다', async () => {
    await repo.record(entryInput());
    const entries = await repo.record(entryInput({ hero: 'BB', scenario: vsOpenScenario }));
    expect(entries).toHaveLength(2);
  });

  it('설정이 다르면 별개 기록이다', async () => {
    // 40bb에서의 답과 100bb에서의 답은 다른 정보다. 합치면 안 된다.
    await repo.record(entryInput());
    const entries = await repo.record(
      entryInput({ config: { ...DEFAULT_6MAX_100BB, stack: 40 } }),
    );
    expect(entries).toHaveLength(2);
  });

  it('고정한 기록이 목록 위로 온다', async () => {
    await repo.record(entryInput());
    await repo.record(entryInput({ handIndex: handStringToIndex('72o') }));
    const before = await repo.list();
    const oldest = before[before.length - 1]!;

    const after = await repo.togglePin(oldest.id);
    expect(after[0]!.id).toBe(oldest.id);
    expect(after[0]!.pinned).toBe(true);
  });

  it('비우기는 고정한 기록을 남긴다', async () => {
    await repo.record(entryInput());
    await repo.record(entryInput({ handIndex: handStringToIndex('72o') }));
    const entries = await repo.list();
    await repo.togglePin(entries[0]!.id);

    const remaining = await repo.clear();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.pinned).toBe(true);
  });

  it('개별 삭제가 된다', async () => {
    const entries = await repo.record(entryInput());
    const remaining = await repo.remove(entries[0]!.id);
    expect(remaining).toHaveLength(0);
  });

  it('고정하지 않은 기록은 100개까지만 쌓인다', async () => {
    for (let i = 0; i < 120; i++) {
      await repo.record(entryInput({ handIndex: i % 169 }));
    }
    const entries = await repo.list();
    expect(entries.length).toBeLessThanOrEqual(100);
  });

  it('저장 내용이 깨져 있어도 앱이 죽지 않는다', async () => {
    store.set('holdem-gto:history:v1', '{{{ 깨진 JSON');
    expect(await repo.list()).toEqual([]);
  });
});

describe('상대 시각 표기', () => {
  const now = new Date('2026-08-07T12:00:00Z').getTime();

  it('사람이 읽는 말로 바꾼다', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('방금');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5분 전');
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3시간 전');
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe('어제');
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe('4일 전');
  });
});

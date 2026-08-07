import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyAction, initialSequence, type SequenceState } from '@holdem/solver';
import { beforeAll, describe, expect, it } from 'vitest';

import { parsePreflopData, type PreflopData, type PreflopDataFile } from './preflop-data';
import { resolveSequence } from './sequence-resolve';

/**
 * 사람이 직접 넣은 액션이 실제 레인지로 이어지는지 확인한다.
 *
 * 특히 중요한 건 **금액이 다를 때 조용히 넘어가지 않는 것**이다.
 * 2.5bb 기준으로 풀어둔 답을 3bb 상황에 쓰면 그냥 틀린 답인데,
 * 그걸 그럴듯하게 보여주면 초보자는 그대로 따라 한다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../public/data/preflop-6max-100bb.json');

let data: PreflopData;

beforeAll(() => {
  data = parsePreflopData(JSON.parse(readFileSync(DATA_PATH, 'utf8')) as PreflopDataFile);
});

function play(steps: Array<'fold' | 'call' | 'check' | ['raise', number]>): SequenceState {
  let state = initialSequence(data.config);
  for (const step of steps) {
    if (Array.isArray(step)) state = applyAction(state, 'raise', step[1]);
    else state = applyAction(state, step);
  }
  return state;
}

describe('액션 시퀀스 → 레인지', () => {
  it('진행 중이면 누구 차례인지 알려준다', () => {
    const result = resolveSequence(data, play([['raise', 2.5]]));
    expect(result.kind).toBe('ongoing');
    if (result.kind !== 'ongoing') return;
    expect(result.toAct).toBe('HJ');
  });

  it('전원 폴드하면 카드 볼 일이 없다고 한다', () => {
    const result = resolveSequence(data, play(['fold', 'fold', 'fold', 'fold', 'fold']));
    expect(result.kind).toBe('walkover');
  });

  it('싱글레이즈 팟이면 바로 답할 수 있다', () => {
    // UTG 2.5bb 오픈 → 전원 폴드 → BB 콜
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', 'fold', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.setup.pot).toBeCloseTo(5.5, 5);
    expect(result.setup.oop).toBe('BB');
    expect(result.setup.ip).toBe('UTG');
    console.log(
      `\n  [싱글레이즈] ${result.setup.actionText}\n` +
        `    팟 ${result.setup.pot}bb · BB ${result.setup.oopWidth.toFixed(1)}% vs UTG ${result.setup.ipWidth.toFixed(1)}%`,
    );
  });

  it('3벳 팟도 바로 답할 수 있다', () => {
    // UTG 2.5bb 오픈 → CO 7.5bb 3벳 → 나머지 폴드 → UTG 콜
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', ['raise', 7.5], 'fold', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.setup.pot).toBeCloseTo(16.5, 5);
    console.log(
      `  [3벳 팟] ${result.setup.actionText}\n` +
        `    팟 ${result.setup.pot}bb · ${result.setup.oop} ${result.setup.oopWidth.toFixed(1)}% vs ${result.setup.ip} ${result.setup.ipWidth.toFixed(1)}%`,
    );
    // 3벳까지 갔으면 양쪽 다 좁아야 한다
    expect(result.setup.oopWidth).toBeLessThan(25);
    expect(result.setup.ipWidth).toBeLessThan(25);
  });

  it('셋 이상 남으면 멀티웨이라고 분명히 말한다', () => {
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', 'call', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('multiway');
    if (result.kind !== 'multiway') return;
    expect(result.players).toHaveLength(3);
  });

  it('금액이 다르면 근사하지 않고 다시 풀라고 한다', () => {
    // 기본값은 2.5bb인데 3bb로 열었다
    const result = resolveSequence(
      data,
      play([['raise', 3], 'fold', 'fold', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('needs-resolve');
    if (result.kind !== 'needs-resolve') return;
    expect(result.changes.join(' ')).toContain('오픈 3bb');
    console.log(`\n  [금액 불일치] ${result.changes.join(' / ')}`);
    // 다시 풀 설정에는 사용자가 넣은 금액이 반영돼 있어야 한다
    expect(result.config.openSize.UTG).toBe(3);
  });

  it('3벳 금액이 다른 경우도 잡는다', () => {
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', ['raise', 12], 'fold', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('needs-resolve');
    if (result.kind !== 'needs-resolve') return;
    expect(result.changes.join(' ')).toContain('3벳 12bb');
    console.log(`  [3벳 불일치] ${result.changes.join(' / ')}\n`);
  });

  it('되찾은 레인지가 비어 있지 않다', () => {
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', 'fold', 'fold', 'fold', 'call']),
    );
    if (result.kind !== 'ready') throw new Error('ready여야 함');
    expect(result.setup.oopWidth).toBeGreaterThan(0);
    expect(result.setup.ipWidth).toBeGreaterThan(0);
  });
});

describe('우리 모델에 없는 형태는 분명히 거른다', () => {
  it('오픈한 사람이 접고 다른 둘이 남으면 못 푼다고 한다', () => {
    // CO 오픈 → BTN 3벳 → BB 콜 → CO 폴드.
    // 첫 레이저(CO)를 오프너로 잡으면 엉뚱한 스팟의 레인지를 가져오게 된다.
    const state = play([
      'fold', // UTG
      'fold', // HJ
      ['raise', 2.5], // CO 오픈
      ['raise', 7.5], // BTN 3벳
      'fold', // SB
      'call', // BB 콜 (스퀴즈 콜)
      'fold', // CO 폴드
    ]);
    const result = resolveSequence(data, state);
    expect(result.kind).toBe('unsupported');
    if (result.kind !== 'unsupported') return;
    console.log(`\n  [스퀴즈] ${result.reason} — ${result.detail}\n`);
  });

  it('중간에 낀 사람이 있으면 못 푼다고 한다', () => {
    // UTG 오픈 → CO 콜 → BB 3벳 → UTG 폴드 → CO 콜
    const state = play([
      ['raise', 2.5], // UTG
      'fold', // HJ
      'call', // CO 콜
      'fold', // BTN
      'fold', // SB
      ['raise', 12], // BB 스퀴즈
      'fold', // UTG
      'call', // CO
    ]);
    const result = resolveSequence(data, state);
    expect(result.kind).toBe('unsupported');
  });

  it('정상 상황은 여전히 잘 푼다', () => {
    const result = resolveSequence(
      data,
      play([['raise', 2.5], 'fold', 'fold', 'fold', 'fold', 'call']),
    );
    expect(result.kind).toBe('ready');
  });
});

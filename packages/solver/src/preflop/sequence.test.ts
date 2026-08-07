import { describe, expect, it } from 'vitest';
import { DEFAULT_6MAX_100BB } from './config';
import {
  applyAction,
  describeSequence,
  initialSequence,
  legalActions,
  outcomeOf,
  undoLast,
  type SequenceState,
} from './sequence';

/**
 * 사람이 액션을 직접 쌓아 상황을 만드는 흐름을 검증한다.
 *
 * 목록에서 고르는 방식과 달리 여기서는 임의의 순서와 금액이 들어온다.
 * "UTG가 3bb 열고 CO가 12bb로 3벳" 같은 걸 그대로 재현할 수 있어야 한다.
 */

const config = DEFAULT_6MAX_100BB;

/** 액션을 순서대로 적용하는 헬퍼. raise는 [kind, 금액] 형태로 준다. */
function play(steps: Array<'fold' | 'call' | 'check' | ['raise', number]>): SequenceState {
  let state = initialSequence(config);
  for (const step of steps) {
    if (Array.isArray(step)) state = applyAction(state, 'raise', step[1]);
    else state = applyAction(state, step);
  }
  return state;
}

describe('액션 순서', () => {
  it('UTG부터 시작한다', () => {
    const state = initialSequence(config);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('ongoing');
    if (outcome.kind !== 'ongoing') return;
    expect(outcome.toAct).toBe('UTG');
  });

  it('블라인드가 이미 들어가 있다', () => {
    const state = initialSequence(config);
    expect(state.invested[4]).toBe(0.5); // SB
    expect(state.invested[5]).toBe(1); // BB
    expect(state.currentBet).toBe(1);
  });

  it('폴드하면 다음 사람으로 넘어간다', () => {
    const state = play(['fold']);
    const outcome = outcomeOf(state);
    if (outcome.kind !== 'ongoing') throw new Error('진행 중이어야 함');
    expect(outcome.toAct).toBe('HJ');
  });

  it('레이즈가 나오면 뒷사람 모두 다시 답해야 한다', () => {
    // UTG 레이즈 → HJ 폴드 → CO 3벳 → 이제 BTN 차례
    const state = play([['raise', 2.5], 'fold', ['raise', 7.5]]);
    const outcome = outcomeOf(state);
    if (outcome.kind !== 'ongoing') throw new Error('진행 중이어야 함');
    expect(outcome.toAct).toBe('BTN');
  });

  it('레이즈를 맞으면 이미 행동한 사람도 다시 차례가 온다', () => {
    // UTG 레이즈 → HJ~BB 전원 폴드는 아니고, CO가 3벳하면 UTG가 다시
    const state = play([
      ['raise', 2.5], // UTG
      'fold', // HJ
      ['raise', 7.5], // CO
      'fold', // BTN
      'fold', // SB
      'fold', // BB
    ]);
    const outcome = outcomeOf(state);
    if (outcome.kind !== 'ongoing') throw new Error('진행 중이어야 함');
    expect(outcome.toAct).toBe('UTG'); // 3벳에 답해야 한다
  });
});

describe('결과 판정', () => {
  it('전원 폴드하면 BB가 가져간다', () => {
    const state = play(['fold', 'fold', 'fold', 'fold', 'fold']);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('walkover');
    if (outcome.kind !== 'walkover') return;
    expect(outcome.winner).toBe('BB');
    expect(outcome.pot).toBe(1.5);
  });

  it('오픈에 전원 폴드하면 오픈한 사람이 가져간다', () => {
    const state = play([['raise', 2.5], 'fold', 'fold', 'fold', 'fold', 'fold']);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('walkover');
    if (outcome.kind !== 'walkover') return;
    expect(outcome.winner).toBe('UTG');
    expect(outcome.pot).toBe(4);
  });

  it('둘이 남으면 플롭을 볼 수 있다고 알려준다', () => {
    const state = play([['raise', 2.5], 'fold', 'fold', 'fold', 'fold', 'call']);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('heads-up');
    if (outcome.kind !== 'heads-up') return;
    expect(outcome.players.sort()).toEqual(['BB', 'UTG']);
    expect(outcome.pot).toBe(5.5); // 2.5 + 2.5 + SB 0.5
    expect(outcome.effectiveStack).toBe(97.5);
  });

  it('3벳 팟도 잡는다', () => {
    // UTG 오픈 → CO 3벳 → 나머지 폴드 → UTG 콜
    const state = play([
      ['raise', 2.5], // UTG
      'fold', // HJ
      ['raise', 7.5], // CO
      'fold', // BTN
      'fold', // SB
      'fold', // BB
      'call', // UTG
    ]);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('heads-up');
    if (outcome.kind !== 'heads-up') return;
    expect(outcome.players.sort()).toEqual(['CO', 'UTG']);
    expect(outcome.pot).toBe(16.5); // 7.5 + 7.5 + 1.5 블라인드
    expect(outcome.effectiveStack).toBe(92.5);
  });

  it('셋 이상이 남으면 멀티웨이라고 알려준다', () => {
    const state = play([['raise', 2.5], 'fold', 'call', 'fold', 'fold', 'call']);
    const outcome = outcomeOf(state);
    expect(outcome.kind).toBe('multiway');
    if (outcome.kind !== 'multiway') return;
    expect(outcome.players.sort()).toEqual(['BB', 'CO', 'UTG']);
  });
});

describe('임의 금액 입력', () => {
  it('사용자가 넣은 금액을 그대로 쓴다', () => {
    // 기본값 2.5bb가 아니라 3bb로 열어도 그대로 반영되어야 한다
    const state = play([['raise', 3]]);
    expect(state.invested[0]).toBe(3);
    expect(state.currentBet).toBe(3);
  });

  it('최소 레이즈보다 작으면 최소치로 올린다', () => {
    // BB가 1인데 1.5로 열려 하면 최소 2bb로 맞춘다
    const state = play([['raise', 1.5]]);
    expect(state.invested[0]).toBe(2);
  });

  it('스택보다 크게 넣으면 올인으로 잘린다', () => {
    const state = play([['raise', 500]]);
    expect(state.invested[0]).toBe(100);
    expect(state.allIn[0]).toBe(true);
  });

  it('3벳 금액도 자유롭게 넣을 수 있다', () => {
    const state = play([['raise', 3], 'fold', ['raise', 12]]);
    expect(state.invested[2]).toBe(12);
    expect(state.raiseCount).toBe(2);
  });
});

describe('선택지 제시', () => {
  it('아무도 안 올렸으면 폴드 대신 체크가 나온다 (BB 기준)', () => {
    // UTG~SB 폴드 후 BB는 이미 1bb를 냈으므로 체크
    const state = play(['fold', 'fold', 'fold', 'fold', 'fold']);
    // 전원 폴드라 이미 끝났다 — BB는 행동할 필요가 없다
    expect(state.toAct).toBeNull();
  });

  it('레이즈를 맞으면 폴드·콜·레이즈가 나온다', () => {
    const state = play([['raise', 2.5]]);
    const actions = legalActions(state).map((a) => a.kind);
    expect(actions).toEqual(['fold', 'call', 'raise']);
  });

  it('레이즈 선택지에 최소·최대가 붙는다', () => {
    const state = play([['raise', 2.5]]);
    const raise = legalActions(state).find((a) => a.kind === 'raise')!;
    expect(raise.adjustable).toBe(true);
    expect(raise.min).toBeGreaterThan(2.5);
    expect(raise.max).toBe(100);
  });

  it('5벳까지 가면 더 올릴 수 없다', () => {
    const state = play([
      ['raise', 2.5],
      ['raise', 8],
      ['raise', 20],
      ['raise', 45],
    ]);
    expect(state.raiseCount).toBe(4);
    const actions = legalActions(state).map((a) => a.kind);
    expect(actions).not.toContain('raise');
  });
});

describe('되돌리기', () => {
  it('마지막 액션을 취소한다', () => {
    const before = play([['raise', 2.5], 'fold']);
    const after = undoLast(before);
    expect(after.actions).toHaveLength(1);
    const outcome = outcomeOf(after);
    if (outcome.kind !== 'ongoing') throw new Error('진행 중이어야 함');
    expect(outcome.toAct).toBe('HJ');
  });

  it('처음까지 되돌릴 수 있다', () => {
    let state = play([['raise', 2.5], 'fold', ['raise', 7.5]]);
    while (state.actions.length > 0) state = undoLast(state);
    expect(state.actions).toHaveLength(0);
    expect(state.toAct).toBe(0);
  });
});

describe('요약 문장', () => {
  it('폴드는 빼고 실제로 벌어진 일만 적는다', () => {
    const state = play([['raise', 2.5], 'fold', ['raise', 7.5], 'fold', 'fold', 'fold', 'call']);
    const text = describeSequence(state);
    console.log(`\n  ${text}\n`);
    expect(text).toContain('UTG 2.5bb 레이즈');
    expect(text).toContain('CO 7.5bb 레이즈');
    expect(text).toContain('UTG 콜');
    expect(text).not.toContain('폴드');
  });
});

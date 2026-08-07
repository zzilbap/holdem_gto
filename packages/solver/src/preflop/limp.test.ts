import { NUM_HANDS, combosOfHand, handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_6MAX_100BB } from './config';
import { buildPreflopEquityTable } from './equity-table';
import { MeasuredRealization } from './measured-realization';
import { MEASURED_REALIZATION } from './realization-data.generated';
import { makeLimpDefinition, solvePreflop, type PreflopSolution } from './solve';
import { buildSpotTree } from './spot';

/**
 * 스몰블라인드 림프.
 *
 * SB는 이미 0.5bb를 냈으므로 0.5bb만 더 내면 플롭을 본다. 이 값이 워낙 싸서
 * 실제 해법에도 림프가 유의미하게 존재한다. 처음에는 트리 크기 때문에 뺐는데,
 * 2인 스팟으로 쪼갠 구조에서는 스팟 하나만 더 풀면 된다.
 */

let solution: PreflopSolution;

beforeAll(() => {
  const equityTable = buildPreflopEquityTable({ boardSamples: 2000, seed: 8123 });
  solution = solvePreflop({
    config: DEFAULT_6MAX_100BB,
    equityTable,
    realization: new MeasuredRealization(MEASURED_REALIZATION),
    rounds: 4,
    iterationsPerSpot: 200,
  });
});

function share(range: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) combos += range[h]! * combosOfHand(h).length;
  return (combos / 1326) * 100;
}

describe('림프 스팟 트리', () => {
  const config = { ...DEFAULT_6MAX_100BB, allowLimp: true };
  const tree = buildSpotTree(makeLimpDefinition(config), config);

  it('림프를 받은 BB가 먼저 답한다', () => {
    expect(tree.positions).toEqual(['BB', 'SB']);
    const root = tree.nodes[tree.root]!;
    expect(root.kind).toBe('action');
    if (root.kind !== 'action') return;
    expect(root.player).toBe(0);
  });

  it('BB는 체크하거나 올릴 수 있다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const kinds = root.actions.map((a) => a.kind);
    expect(kinds).toContain('check');
    expect(kinds.some((k) => k === 'raise' || k === 'allin')).toBe(true);
    // 낼 돈이 없으니 폴드는 선택지가 아니다.
    expect(kinds).not.toContain('fold');
  });

  it('양쪽이 체크하면 바로 플롭이다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const checkIndex = root.actions.findIndex((a) => a.kind === 'check');
    const afterCheck = tree.nodes[root.children[checkIndex]!]!;
    expect(afterCheck.kind).toBe('terminal');
    if (afterCheck.kind !== 'terminal') return;
    expect(afterCheck.terminal).toBe('postflop');
    expect(afterCheck.pot).toBe(2); // 1bb씩
  });

  it('SB가 림프로 이미 행동했다고 잡는다', () => {
    // 이걸 빠뜨리면 BB가 체크한 뒤에도 SB에게 또 차례가 온다.
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const checkIndex = root.actions.findIndex((a) => a.kind === 'check');
    const afterCheck = tree.nodes[root.children[checkIndex]!]!;
    expect(afterCheck.kind).toBe('terminal');
  });

  it('BB가 올리면 SB가 다시 답한다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const raiseIndex = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
    const afterRaise = tree.nodes[root.children[raiseIndex]!]!;
    expect(afterRaise.kind).toBe('action');
    if (afterRaise.kind !== 'action') return;
    expect(afterRaise.player).toBe(1); // SB
    expect(afterRaise.actions.map((a) => a.kind)).toContain('fold');
  });
});

describe('SB의 선택', () => {
  it('림프가 실제로 나온다', () => {
    const limpPct = share(solution.limpFrequency);
    const raisePct = share(solution.openFrequency.SB);
    console.log(
      `\nSB — 레이즈 ${raisePct.toFixed(1)}% · 림프 ${limpPct.toFixed(1)}% · ` +
        `폴드 ${(100 - raisePct - limpPct).toFixed(1)}%`,
    );
    expect(limpPct).toBeGreaterThan(0);
  });

  it('레이즈와 림프를 합쳐도 100%를 넘지 않는다', () => {
    for (let h = 0; h < NUM_HANDS; h++) {
      expect(solution.openFrequency.SB[h]! + solution.limpFrequency[h]!).toBeLessThanOrEqual(1.001);
    }
  });

  it('프리미엄 패는 절대 접지 않는다', () => {
    /**
     * "강한 패는 항상 레이즈"가 아니다. 실제 해법에서도 SB는 AA·KK 일부를
     * 림프에 섞는다 — 그래야 BB가 림프 레인지를 함부로 공격하지 못한다.
     * 그래서 레이즈만 보지 말고 "들어가는 비중"을 봐야 한다.
     */
    for (const hand of ['AA', 'KK', 'AKs', 'QQ']) {
      const h = handStringToIndex(hand);
      const enters = solution.openFrequency.SB[h]! + solution.limpFrequency[h]!;
      expect(enters, `${hand} 참여`).toBeGreaterThan(0.95);
    }
    const aa = handStringToIndex('AA');
    console.log(
      `AA — 레이즈 ${(solution.openFrequency.SB[aa]! * 100).toFixed(0)}% · ` +
        `림프 ${(solution.limpFrequency[aa]! * 100).toFixed(0)}%`,
    );
  });

  it('최악의 패는 대부분 접는다', () => {
    for (const hand of ['72o', '83o', '92o']) {
      const h = handStringToIndex(hand);
      const enters = solution.openFrequency.SB[h]! + solution.limpFrequency[h]!;
      expect(enters, `${hand} 참여`).toBeLessThan(0.5);
    }
  });

  it('림프 스팟이 풀려 있다', () => {
    expect(solution.limp).not.toBeNull();
    expect(solution.limp?.sbEv.length).toBe(NUM_HANDS);
  });

  it('들어가기로 한 패의 EV가 폴드보다 낫다', () => {
    /**
     * SB가 접으면 이미 낸 0.5bb를 잃는다. 그러니 참여를 택한 패는 -0.5bb보다
     * 나아야 한다. CFR 수렴 오차가 있으니 아주 작은 여유는 둔다.
     */
    let checked = 0;
    let worst = Infinity;
    for (let h = 0; h < NUM_HANDS; h++) {
      const enters = solution.openFrequency.SB[h]! + solution.limpFrequency[h]!;
      if (enters < 0.5) continue;
      worst = Math.min(worst, solution.limp!.sbEv[h]!);
      expect(solution.limp!.sbEv[h]!).toBeGreaterThan(-0.52);
      checked++;
    }
    console.log(
      `참여하는 패 ${checked}개 — 가장 낮은 EV ${worst.toFixed(3)}bb (폴드는 -0.5bb)`,
    );
    expect(checked).toBeGreaterThan(0);
  });
});

import { NUM_HANDS, combosOfHand, handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_6MAX_100BB } from './config';
import { buildPreflopEquityTable } from './equity-table';
import { MeasuredRealization } from './measured-realization';
import { MEASURED_REALIZATION } from './realization-data.generated';
import { HeuristicRealization } from './realization';
import { rangePercentOf, solvePreflop, spotKey, type PreflopSolution } from './solve';

/**
 * 추측 공식 대신 **실제로 잰 실현율**을 넣으면 얼마나 달라지는지 비교한다.
 *
 * 지금까지 남아 있던 오차는 대부분 R을 공식으로 추측한 데서 왔다.
 * 플롭을 실제로 풀어 잰 값으로 바꾸면 통용되는 해법에 가까워져야 한다.
 */

let heuristic: PreflopSolution;
let measured: PreflopSolution;

beforeAll(() => {
  const equityTable = buildPreflopEquityTable({ boardSamples: 2500, seed: 991 });
  const common = { config: DEFAULT_6MAX_100BB, equityTable, rounds: 5, iterationsPerSpot: 250 };
  heuristic = solvePreflop({ ...common, realization: new HeuristicRealization() });
  measured = solvePreflop({ ...common, realization: new MeasuredRealization(MEASURED_REALIZATION) });
});

function bbFoldShare(solution: PreflopSolution, opener: 'UTG' | 'BTN'): number {
  const spot = solution.spots.get(spotKey(opener, 'BB'))!;
  const root = spot.tree.nodes[spot.tree.root]!;
  if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
  const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
  let folded = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    folded += spot.result.strategy[root.offset + foldIndex * NUM_HANDS + h]! * combosOfHand(h).length;
  }
  return (folded / 1326) * 100;
}

describe('측정 실현율 vs 추측 공식', () => {
  it('두 방식의 결과를 나란히 본다', () => {
    const rows: Array<[string, number, number, number]> = [
      ['UTG RFI', rangePercentOf(heuristic.openFrequency.UTG), rangePercentOf(measured.openFrequency.UTG), 16],
      ['HJ RFI', rangePercentOf(heuristic.openFrequency.HJ), rangePercentOf(measured.openFrequency.HJ), 20],
      ['CO RFI', rangePercentOf(heuristic.openFrequency.CO), rangePercentOf(measured.openFrequency.CO), 27],
      ['BTN RFI', rangePercentOf(heuristic.openFrequency.BTN), rangePercentOf(measured.openFrequency.BTN), 45],
      ['SB RFI', rangePercentOf(heuristic.openFrequency.SB), rangePercentOf(measured.openFrequency.SB), 42],
      ['BB 폴드 vs UTG', bbFoldShare(heuristic, 'UTG'), bbFoldShare(measured, 'UTG'), 57],
      ['BB 폴드 vs BTN', bbFoldShare(heuristic, 'BTN'), bbFoldShare(measured, 'BTN'), 35],
    ];

    console.log('\n지표             추측공식   측정값   통용값   개선');
    for (const [label, h, m, target] of rows) {
      const before = Math.abs(h - target);
      const after = Math.abs(m - target);
      const mark = after < before ? '↑' : after > before ? '↓' : '=';
      console.log(
        `${label.padEnd(15)} ${h.toFixed(1).padStart(6)}% ${m.toFixed(1).padStart(7)}% ` +
          `${String(target).padStart(6)}%   ${mark} ${(before - after).toFixed(1)}%p`,
      );
    }

    const totalBefore = rows.reduce((sum, [, h, , t]) => sum + Math.abs(h - t), 0);
    const totalAfter = rows.reduce((sum, [, , m, t]) => sum + Math.abs(m - t), 0);
    console.log(`\n총 오차 합 — 추측 ${totalBefore.toFixed(1)}%p → 측정 ${totalAfter.toFixed(1)}%p\n`);

    expect(rows.length).toBeGreaterThan(0);
  });

  it('측정값을 써도 기본 성질은 유지된다', () => {
    // 뒷자리로 갈수록 넓어지는 순서가 깨지면 안 된다
    const pct = (p: 'UTG' | 'HJ' | 'CO' | 'BTN') => rangePercentOf(measured.openFrequency[p]);
    expect(pct('HJ')).toBeGreaterThan(pct('UTG'));
    expect(pct('CO')).toBeGreaterThan(pct('HJ'));
    expect(pct('BTN')).toBeGreaterThan(pct('CO'));
  });

  it('프리미엄 핸드는 여전히 전 포지션에서 오픈한다', () => {
    for (const position of ['UTG', 'CO', 'BTN'] as const) {
      for (const hand of ['AA', 'KK', 'AKs']) {
        expect(
          measured.openFrequency[position][handStringToIndex(hand)],
          `${position} ${hand}`,
        ).toBeGreaterThan(0.9);
      }
    }
  });

  it('수렴한다', () => {
    expect(measured.lastRoundDrift).toBeLessThan(0.05);
  });
});

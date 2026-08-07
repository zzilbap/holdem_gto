import { NUM_HANDS, combosOfHand, handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_6MAX_100BB } from './config';
import { buildPreflopEquityTable } from './equity-table';
import { MeasuredRealization } from './measured-realization';
import { MEASURED_REALIZATION } from './realization-data.generated';
import {
  enumerateSqueezeTriples,
  solvePreflop,
  squeezeKey,
  type PreflopSolution,
} from './solve';

/**
 * 스퀴즈 스팟 — 누가 열고 다른 사람이 3벳한 뒤 세 번째 사람이 결정하는 자리.
 *
 * "CO 오픈 → BTN 3벳 → BB 차례"가 대표적이다. 이전에는 이 상황을 아예 못 다뤄
 * 엉뚱한 스팟의 레인지를 보여주는 버그까지 있었다.
 */

let solution: PreflopSolution;

beforeAll(() => {
  const equityTable = buildPreflopEquityTable({ boardSamples: 2000, seed: 5150 });
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

function actionShare(key: string, kind: 'fold' | 'call' | 'raise' | 'allin'): number {
  const squeeze = solution.squeezes.get(key)!;
  const root = squeeze.tree.nodes[squeeze.tree.root]!;
  if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
  const index = root.actions.findIndex((a) => a.kind === kind);
  if (index < 0) return 0;

  const freq = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    freq[h] = squeeze.result.strategy[root.offset + index * NUM_HANDS + h]!;
  }
  return share(freq);
}

describe('스퀴즈 스팟', () => {
  it('조합이 자리 순서를 지킨다', () => {
    const triples = enumerateSqueezeTriples();
    expect(triples.length).toBeGreaterThan(0);
    for (const { opener, threeBettor, squeezer } of triples) {
      const order = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
      expect(order.indexOf(opener)).toBeLessThan(order.indexOf(threeBettor));
      expect(order.indexOf(threeBettor)).toBeLessThan(order.indexOf(squeezer));
    }
    console.log(`\n스퀴즈 조합 ${triples.length}개`);
  });

  it('풀린 스퀴즈 스팟이 있다', () => {
    expect(solution.squeezes.size).toBeGreaterThan(0);
    console.log(`풀린 스퀴즈 스팟 ${solution.squeezes.size}개`);
  });

  it('CO 오픈 → BTN 3벳 → BB 상황이 있다', () => {
    const squeeze = solution.squeezes.get(squeezeKey('CO', 'BTN', 'BB'));
    expect(squeeze).toBeDefined();
    if (!squeeze) return;

    const fold = actionShare(squeeze.key, 'fold');
    const call = actionShare(squeeze.key, 'call');
    const raise = actionShare(squeeze.key, 'raise') + actionShare(squeeze.key, 'allin');
    console.log(
      `\n[CO 오픈 → BTN 3벳 → BB] 폴드 ${fold.toFixed(1)}% · 콜 ${call.toFixed(1)}% · 4벳 ${raise.toFixed(1)}%`,
    );
    console.log(`  BTN의 3벳 레인지 ${share(squeeze.threeBetRange).toFixed(1)}%`);

    // 3벳을 맞고 스퀴즈 자리에 있으면 압도적으로 접어야 한다
    expect(fold).toBeGreaterThan(80);
    expect(fold + call + raise).toBeCloseTo(100, 0);
  });

  it('AA는 접지 않는다', () => {
    const squeeze = solution.squeezes.get(squeezeKey('CO', 'BTN', 'BB'))!;
    const root = squeeze.tree.nodes[squeeze.tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
    const aa = handStringToIndex('AA');
    const foldFreq = squeeze.result.strategy[root.offset + foldIndex * NUM_HANDS + aa]!;
    expect(foldFreq).toBeLessThan(0.1);
  });

  it('72o는 접는다', () => {
    const squeeze = solution.squeezes.get(squeezeKey('CO', 'BTN', 'BB'))!;
    const root = squeeze.tree.nodes[squeeze.tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
    const trash = handStringToIndex('72o');
    const foldFreq = squeeze.result.strategy[root.offset + foldIndex * NUM_HANDS + trash]!;
    expect(foldFreq).toBeGreaterThan(0.9);
  });

  it('죽은 돈이 팟에 반영된다', () => {
    // CO가 2.5bb를 두고 갔으므로 팟에 남아야 한다
    const squeeze = solution.squeezes.get(squeezeKey('CO', 'BTN', 'BB'))!;
    expect(squeeze.tree.definition.deadMoney).toBeCloseTo(3, 5); // CO 2.5 + SB 0.5
  });

  it('스퀴저가 먼저 행동한다', () => {
    const squeeze = solution.squeezes.get(squeezeKey('CO', 'BTN', 'BB'))!;
    expect(squeeze.tree.positions[0]).toBe('BB');
    expect(squeeze.tree.positions[1]).toBe('BTN');
  });
});

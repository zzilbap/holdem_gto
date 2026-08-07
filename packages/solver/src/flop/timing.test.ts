import { handRangeToCombos, parseCards, parseRange } from '@holdem/poker-core';
import { describe, expect, it } from 'vitest';

import { buildFlopEquityMatrix, collectLiveCombos } from './board';
import { solveFlop } from './cfr';
import { DEFAULT_FLOP_CONFIG, buildFlopTree } from './tree';

/**
 * 실제 스팟 크기에서 얼마나 걸리는지 잰다.
 *
 * 플롭은 미리 계산해 둘 수 없어 사용자가 매번 기다린다. 그래서 "몇 초냐"가
 * 기능의 일부다. 레인지가 넓어지면 에퀴티 행렬이 제곱으로 커지므로
 * 현실적인 크기에서 재봐야 한다.
 */
describe('플롭 솔브 시간', () => {
  it('실제 싱글레이즈 팟 크기에서 재본다', () => {
    // BTN 오픈 48% vs BB 콜 40% 정도가 실제 값이다.
    const board = parseCards('Kh8d3c');
    const btnOpen = parseRange(
      '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, ' +
        'A2o+, K7o+, Q8o+, J8o+, T8o+, 98o, 87o',
    );
    const bbCall = parseRange(
      '22+, A2s+, K2s+, Q2s+, J4s+, T5s+, 95s+, 84s+, 74s+, 63s+, 53s+, 43s, ' +
        'A2o+, K5o+, Q7o+, J8o+, T8o+, 97o+, 87o, 76o',
    );

    const oop = collectLiveCombos(handRangeToCombos(bbCall), board);
    const ip = collectLiveCombos(handRangeToCombos(btnOpen), board);
    console.log(`콤보 수 — 앞사람 ${oop.count} · 뒷사람 ${ip.count}`);

    const equityStart = Date.now();
    const equity = buildFlopEquityMatrix(oop, ip, board);
    const equityMs = Date.now() - equityStart;

    const tree = buildFlopTree(
      { ...DEFAULT_FLOP_CONFIG, pot: 5.5, effectiveStack: 97.5 },
      [oop.count, ip.count],
    );

    const solveStart = Date.now();
    const result = solveFlop(tree, { iterations: 400, hero: oop, villain: ip, equity });
    const solveMs = Date.now() - solveStart;

    console.log(
      `에퀴티 행렬 ${(equityMs / 1000).toFixed(1)}초 · CFR ${(solveMs / 1000).toFixed(1)}초 ` +
        `· 합계 ${((equityMs + solveMs) / 1000).toFixed(1)}초`,
    );
    console.log(`노드 ${tree.nodes.length}개 · 전략 슬롯 ${tree.strategySize.toLocaleString()}`);
    console.log(`EV 합 ${(result.meanEv[0] + result.meanEv[1]).toFixed(3)}bb (팟 5.5bb)`);

    // 제로섬은 크기와 무관하게 지켜져야 한다.
    expect(result.meanEv[0] + result.meanEv[1]).toBeCloseTo(5.5, 1);
  }, 300000);
});

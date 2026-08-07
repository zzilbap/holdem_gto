import { NUM_HANDS, combosOfHand, handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_6MAX_100BB } from './config';
import { buildPreflopEquityTable } from './equity-table';
import { HeuristicRealization } from './realization';
import {
  enumerateSpotPairs,
  makeSpotDefinition,
  rangePercentOf,
  solvePreflop,
  spotKey,
  type PreflopSolution,
} from './solve';

let solution: PreflopSolution;

beforeAll(() => {
  const equityTable = buildPreflopEquityTable({ boardSamples: 2500, seed: 991 });
  const started = Date.now();
  solution = solvePreflop({
    config: DEFAULT_6MAX_100BB,
    equityTable,
    realization: new HeuristicRealization(),
    rounds: 5,
    iterationsPerSpot: 250,
  });
  console.log(`프리플롭 전체 솔브 ${((Date.now() - started) / 1000).toFixed(1)}초`);
});

describe('스팟 구성', () => {
  it('6맥스에서 스팟은 15개다', () => {
    expect(enumerateSpotPairs()).toHaveLength(15);
  });

  it('데드머니를 옳게 센다', () => {
    const config = DEFAULT_6MAX_100BB;

    // UTG 오픈에 CO가 대응 — SB와 BB의 1.5bb가 죽은 돈
    const utgVsCo = makeSpotDefinition('UTG', 'CO', config);
    expect(utgVsCo.deadMoney).toBe(1.5);
    expect(utgVsCo.invested).toEqual([0, 2.5]);

    // UTG 오픈에 BB가 대응 — BB는 플레이어이므로 SB 0.5만 죽은 돈
    const utgVsBb = makeSpotDefinition('UTG', 'BB', config);
    expect(utgVsBb.deadMoney).toBe(0.5);
    expect(utgVsBb.invested).toEqual([1, 2.5]);

    // SB 오픈에 BB가 대응 — 죽은 돈 없음, 둘 다 블라인드를 냈다
    const sbVsBb = makeSpotDefinition('SB', 'BB', config);
    expect(sbVsBb.deadMoney).toBe(0);
    expect(sbVsBb.invested).toEqual([1, 3]);
  });

  it('오픈이 끝난 뒤라 반응하는 쪽이 먼저 행동한다', () => {
    const spot = makeSpotDefinition('BTN', 'BB', DEFAULT_6MAX_100BB);
    expect(spot.first).toBe('BB');
    expect(spot.second).toBe('BTN');
    expect(spot.raiseCount).toBe(1);
  });
});

describe('RFI 차트', () => {
  it('뒷자리로 갈수록 오픈 레인지가 넓어진다', () => {
    const pct = (p: 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB') =>
      rangePercentOf(solution.openFrequency[p]);

    console.log(
      `RFI — UTG ${pct('UTG').toFixed(1)}% · HJ ${pct('HJ').toFixed(1)}% · ` +
        `CO ${pct('CO').toFixed(1)}% · BTN ${pct('BTN').toFixed(1)}% · SB ${pct('SB').toFixed(1)}%`,
    );

    expect(pct('HJ')).toBeGreaterThan(pct('UTG'));
    expect(pct('CO')).toBeGreaterThan(pct('HJ'));
    expect(pct('BTN')).toBeGreaterThan(pct('CO'));
  });

  it('오픈 레인지가 상식적인 범위 안에 있다', () => {
    const utg = rangePercentOf(solution.openFrequency.UTG);
    const btn = rangePercentOf(solution.openFrequency.BTN);
    expect(utg).toBeGreaterThan(8);
    expect(utg).toBeLessThan(30);
    expect(btn).toBeGreaterThan(30);
    expect(btn).toBeLessThan(65);
  });

  it('프리미엄 핸드는 어느 자리에서도 오픈한다', () => {
    for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const) {
      for (const hand of ['AA', 'KK', 'QQ', 'AKs', 'AKo']) {
        expect(
          solution.openFrequency[position][handStringToIndex(hand)],
          `${position} ${hand}`,
        ).toBeGreaterThan(0.9);
      }
    }
  });

  it('최악의 핸드는 UTG에서 오픈하지 않는다', () => {
    for (const hand of ['72o', '83o', '92o', 'J2o', '43o']) {
      expect(
        solution.openFrequency.UTG[handStringToIndex(hand)],
        `UTG ${hand}`,
      ).toBeLessThan(0.1);
    }
  });

  it('오픈 이득이 강한 핸드일수록 크다', () => {
    const edge = solution.openEdge.BTN;
    expect(edge[handStringToIndex('AA')]).toBeGreaterThan(edge[handStringToIndex('KK')]!);
    expect(edge[handStringToIndex('AKs')]).toBeGreaterThan(edge[handStringToIndex('A5s')]!);
    expect(edge[handStringToIndex('AA')]).toBeGreaterThan(edge[handStringToIndex('72o')]!);
  });

  it('같은 핸드는 수딧이 오프수트보다 자주 오픈된다', () => {
    const co = solution.openFrequency.CO;
    for (const [s, o] of [
      ['KTs', 'KTo'],
      ['QTs', 'QTo'],
      ['J9s', 'J9o'],
    ] as const) {
      expect(co[handStringToIndex(s)], `${s} vs ${o}`).toBeGreaterThanOrEqual(
        co[handStringToIndex(o)]!,
      );
    }
  });
});

describe('수렴', () => {
  it('마지막 라운드에서 레인지가 거의 움직이지 않는다', () => {
    console.log(`마지막 라운드 변동량 ${solution.lastRoundDrift.toFixed(5)}`);
    expect(solution.lastRoundDrift).toBeLessThan(0.05);
  });

  it('15개 스팟이 모두 풀렸다', () => {
    expect(solution.spots.size).toBe(15);
    for (const { opener, responder } of enumerateSpotPairs()) {
      expect(solution.spots.has(spotKey(opener, responder))).toBe(true);
    }
  });
});

describe('대응 전략', () => {
  it('BB는 BTN 오픈보다 UTG 오픈에 더 자주 폴드한다', () => {
    const vsUtg = solution.spots.get(spotKey('UTG', 'BB'))!;
    const vsBtn = solution.spots.get(spotKey('BTN', 'BB'))!;

    const foldRate = (spot: typeof vsUtg) => {
      let sum = 0;
      for (let h = 0; h < NUM_HANDS; h++) sum += spot.responderFoldProbability[h]!;
      return sum / NUM_HANDS;
    };

    const utgFold = foldRate(vsUtg);
    const btnFold = foldRate(vsBtn);
    console.log(`BB 폴드율 — vs UTG ${(utgFold * 100).toFixed(1)}% · vs BTN ${(btnFold * 100).toFixed(1)}%`);
    expect(utgFold).toBeGreaterThan(btnFold);
  });

  it('BB의 대응이 상식적인 범위 안에 있다', () => {
    /**
     * BB는 이미 1bb를 냈으니 1.5bb만 더 내면 4bb 팟을 본다. 필요 승률이 27%라
     * 다른 자리보다 훨씬 넓게 받는다. 하지만 아웃오브포지션이라 무한정 받지도 않는다.
     *
     * 이 테스트는 두 방향의 버그를 다 잡는다:
     *  - 너무 많이 접으면 → 스팟 트리에 유령 노드가 생겨 콜 가치가 무너진 경우
     *  - 너무 적게 접으면 → 에퀴티 실현율이 아웃오브포지션에 너무 후한 경우
     */
    /**
     * BB 자신의 전략에서 잰다.
     *
     * `responderFoldProbability`를 쓰면 안 된다. 그건 "**오프너가** 그 핸드일 때
     * BB가 접을 확률"이라 인덱스가 오프너의 핸드다. BB의 레인지를 재는 값이 아니다.
     */
    const foldShare = (opener: 'UTG' | 'BTN') => {
      const spot = solution.spots.get(spotKey(opener, 'BB'))!;
      const root = spot.tree.nodes[spot.tree.root]!;
      if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
      const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
      let folded = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        const freq = spot.result.strategy[root.offset + foldIndex * NUM_HANDS + h]!;
        folded += freq * combosOfHand(h).length;
      }
      return (folded / 1326) * 100;
    };

    const vsUtg = foldShare('UTG');
    const vsBtn = foldShare('BTN');
    console.log(
      `BB 폴드 비율(콤보 가중) — vs UTG ${vsUtg.toFixed(1)}% · vs BTN ${vsBtn.toFixed(1)}%  ` +
        `(실제 해법 ≈ 57% / 35%)`,
    );
    expect(vsUtg).toBeGreaterThan(40);
    expect(vsUtg).toBeLessThan(75);
    expect(vsBtn).toBeGreaterThan(15);
    expect(vsBtn).toBeLessThan(55);
  });

  it('BB는 AA로 절대 폴드하지 않는다', () => {
    const spot = solution.spots.get(spotKey('BTN', 'BB'))!;
    const root = spot.tree.nodes[spot.tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');

    const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
    const aa = handStringToIndex('AA');
    const foldFreq = spot.result.strategy[root.offset + foldIndex * NUM_HANDS + aa]!;
    expect(foldFreq).toBeLessThan(0.05);
  });

  it('BB는 AA를 3벳한다', () => {
    const spot = solution.spots.get(spotKey('BTN', 'BB'))!;
    const root = spot.tree.nodes[spot.tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');

    const raiseIndex = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
    expect(raiseIndex).toBeGreaterThanOrEqual(0);
    const aa = handStringToIndex('AA');
    const raiseFreq = spot.result.strategy[root.offset + raiseIndex * NUM_HANDS + aa]!;
    console.log(`BB가 BTN 오픈에 AA로 3벳하는 빈도 ${(raiseFreq * 100).toFixed(1)}%`);
    expect(raiseFreq).toBeGreaterThan(0.4);
  });
});

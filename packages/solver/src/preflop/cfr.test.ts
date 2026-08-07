import { NUM_HANDS, handIndexToString, handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { solveSpot } from './cfr';
import { DEFAULT_6MAX_100BB, type PreflopConfig } from './config';
import { buildPreflopEquityTable } from './equity-table';
import { NoRealization } from './realization';
import { buildSpotTree, type SpotDefinition, type SpotTree } from './spot';

/**
 * CFR이 진짜 균형을 찾는지 확인하는 가장 확실한 방법은 **정답이 알려진 게임**을 풀리는 것이다.
 *
 * 숏스택 푸시/폴드가 딱 그렇다. SB는 올인 아니면 폴드, BB는 콜 아니면 폴드뿐이라
 * 게임이 아주 작고, 내시 균형 차트가 수십 년째 공표되어 있다.
 * 게다가 올인만 있어서 포스트플롭 실현율 근사가 끼어들지 않는다 —
 * 즉 이 테스트는 CFR과 에퀴티 표만 순수하게 검증한다.
 */

let equityTable: Float32Array;

beforeAll(() => {
  equityTable = buildPreflopEquityTable({ boardSamples: 3000, seed: 424242 });
});

function pushFoldConfig(stack: number): PreflopConfig {
  return {
    ...DEFAULT_6MAX_100BB,
    playerCount: 2,
    stack,
    // SB의 오픈 사이즈를 스택 전체로 두면 올인 외의 선택지가 사라진다.
    openSize: { ...DEFAULT_6MAX_100BB.openSize, SB: stack },
    allInThreshold: 0.5,
  };
}

function pushFoldSpot(): SpotDefinition {
  return {
    first: 'SB',
    second: 'BB',
    deadMoney: 0,
    invested: [0.5, 1],
    raiseCount: 0,
    label: '숏스택 헤즈업, SB 선택',
  };
}

function solvePushFold(stack: number, iterations = 600) {
  const config = pushFoldConfig(stack);
  const tree = buildSpotTree(pushFoldSpot(), config);
  const full = new Float32Array(NUM_HANDS).fill(1);
  const result = solveSpot(tree, {
    iterations,
    ranges: [full, new Float32Array(full)],
    equityTable,
    realization: new NoRealization(),
  });
  return { tree, result };
}

/** 특정 액션을 고르는 빈도를 169칸 배열로 뽑아낸다. */
function actionFrequency(tree: SpotTree, strategy: Float32Array, nodeIndex: number, actionIndex: number) {
  const node = tree.nodes[nodeIndex]!;
  if (node.kind !== 'action') throw new Error('액션 노드가 아님');
  const out = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    out[h] = strategy[node.offset + actionIndex * NUM_HANDS + h]!;
  }
  return out;
}

/** 콤보 수를 반영한 "전체 레인지의 몇 %" */
function rangeShare(freq: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    const { length } = comboCountOf(h);
    combos += freq[h]! * length;
  }
  return (combos / 1326) * 100;
}

function comboCountOf(handIndex: number): { length: number } {
  const text = handIndexToString(handIndex);
  if (text.length === 2) return { length: 6 };
  return { length: text.endsWith('s') ? 4 : 12 };
}

describe('푸시/폴드 균형', () => {
  it('트리가 정말 푸시/폴드 두 갈래뿐이다', () => {
    const { tree } = solvePushFold(10, 1);
    const root = tree.nodes[tree.root]!;
    expect(root.kind).toBe('action');
    if (root.kind !== 'action') return;
    expect(root.actions.map((a) => a.kind)).toEqual(['fold', 'allin']);

    const afterPush = tree.nodes[root.children[1]!]!;
    expect(afterPush.kind).toBe('action');
    if (afterPush.kind !== 'action') return;
    expect(afterPush.actions.map((a) => a.kind)).toEqual(['fold', 'call']);
  });

  it('10bb에서 알려진 내시 범위에 가깝다', () => {
    const { tree, result } = solvePushFold(10, 800);
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');

    const pushFreq = actionFrequency(tree, result.strategy, tree.root, 1);
    const callNode = root.children[1]!;
    const callFreq = actionFrequency(tree, result.strategy, callNode, 1);

    const pushPct = rangeShare(pushFreq);
    const callPct = rangeShare(callFreq);
    console.log(`10bb — SB 푸시 ${pushPct.toFixed(1)}% / BB 콜 ${callPct.toFixed(1)}%  (내시 ≈ 59% / 41%)`);

    expect(pushPct).toBeGreaterThan(50);
    expect(pushPct).toBeLessThan(70);
    expect(callPct).toBeGreaterThan(33);
    expect(callPct).toBeLessThan(50);
  });

  it('스택이 짧아질수록 푸시 범위가 넓어진다', () => {
    const shares: number[] = [];
    for (const stack of [20, 12, 6]) {
      const { tree, result } = solvePushFold(stack, 500);
      shares.push(rangeShare(actionFrequency(tree, result.strategy, tree.root, 1)));
    }
    console.log(`푸시 범위 — 20bb ${shares[0]!.toFixed(1)}% · 12bb ${shares[1]!.toFixed(1)}% · 6bb ${shares[2]!.toFixed(1)}%`);
    expect(shares[1]).toBeGreaterThan(shares[0]!);
    expect(shares[2]).toBeGreaterThan(shares[1]!);
  });

  it('강한 패는 항상 푸시하고 최악의 패는 폴드한다', () => {
    const { tree, result } = solvePushFold(10, 800);
    const push = actionFrequency(tree, result.strategy, tree.root, 1);

    for (const hand of ['AA', 'KK', 'QQ', 'AKs', 'AQo', 'A9s', '77']) {
      expect(push[handStringToIndex(hand)], `${hand} 푸시 빈도`).toBeGreaterThan(0.9);
    }
    for (const hand of ['72o', '83o', '94o', 'J2o']) {
      expect(push[handStringToIndex(hand)], `${hand} 푸시 빈도`).toBeLessThan(0.2);
    }
  });

  it('BB 콜 범위가 푸시 범위보다 좁다', () => {
    // 콜하려면 이미 들어온 돈에 맞서 스택 전부를 걸어야 하니 당연히 더 조여야 한다.
    const { tree, result } = solvePushFold(10, 800);
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    const pushPct = rangeShare(actionFrequency(tree, result.strategy, tree.root, 1));
    const callPct = rangeShare(actionFrequency(tree, result.strategy, root.children[1]!, 1));
    expect(callPct).toBeLessThan(pushPct);
  });

  it('AA는 100% 콜, 72o는 콜하지 않는다', () => {
    const { tree, result } = solvePushFold(10, 800);
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    const call = actionFrequency(tree, result.strategy, root.children[1]!, 1);
    expect(call[handStringToIndex('AA')]).toBeGreaterThan(0.95);
    expect(call[handStringToIndex('72o')]).toBeLessThan(0.1);
  });

  it('반복을 늘리면 남은 리그렛이 줄어든다', () => {
    const short = solvePushFold(10, 60).result.residualRegret;
    const long = solvePushFold(10, 900).result.residualRegret;
    console.log(`남은 리그렛 — 60회 ${short.toFixed(5)} → 900회 ${long.toFixed(5)}`);
    expect(long).toBeLessThan(short);
  });
});

describe('EV 정합성', () => {
  it('두 플레이어의 EV 합이 데드머니와 맞아떨어진다', () => {
    // 제로섬이다. 팟에 외부 돈이 없으면 두 사람 EV의 레인지 가중합은 0이어야 한다.
    const { result } = solvePushFold(10, 400);
    let sum = 0;
    for (let h = 0; h < NUM_HANDS; h++) {
      const w = comboCountOf(h).length / 1326;
      sum += (result.rootEv[0][h]! + result.rootEv[1][h]!) * w;
    }
    console.log(`EV 합 = ${sum.toFixed(4)}bb (0이어야 함)`);
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it('AA의 EV가 72o보다 훨씬 높다', () => {
    const { result } = solvePushFold(10, 600);
    const aa = result.rootEv[0][handStringToIndex('AA')]!;
    const trash = result.rootEv[0][handStringToIndex('72o')]!;
    console.log(`SB 기준 EV — AA ${aa.toFixed(3)}bb · 72o ${trash.toFixed(3)}bb`);
    expect(aa).toBeGreaterThan(trash + 1);
  });
});

import {
  handRangeToCombos,
  parseCards,
  parseRange,
  removeBlockedCombos,
} from '@holdem/poker-core';
import { describe, expect, it } from 'vitest';

import { buildFlopEquityMatrix, collectLiveCombos } from './board';
import { solveFlop } from './cfr';
import { DEFAULT_FLOP_CONFIG, buildFlopTree, type FlopConfig } from './tree';

/**
 * 플롭 솔버 검증.
 *
 * 가장 강한 지표는 제로섬이다. 두 사람의 평균 EV를 더하면 정확히 플롭 시작 팟이
 * 나와야 한다 — 플롭에서 오간 돈은 결국 둘 사이에서만 움직이기 때문이다.
 * 트리·쇼다운·충돌 처리 중 어디가 어긋나도 이 합이 깨진다.
 */

function makeConfig(overrides: Partial<FlopConfig> = {}): FlopConfig {
  return { ...DEFAULT_FLOP_CONFIG, pot: 6, effectiveStack: 40, ...overrides };
}

function setup(
  boardText: string,
  heroRange: string,
  villainRange: string,
  config = makeConfig(),
) {
  const board = parseCards(boardText);
  const hero = collectLiveCombos(
    removeBlockedCombos(handRangeToCombos(parseRange(heroRange)), board),
    board,
  );
  const villain = collectLiveCombos(
    removeBlockedCombos(handRangeToCombos(parseRange(villainRange)), board),
    board,
  );
  const equity = buildFlopEquityMatrix(hero, villain, board);
  const tree = buildFlopTree(config, [hero.count, villain.count]);
  return { board, hero, villain, equity, tree, config };
}

describe('플롭 액션 트리', () => {
  const tree = buildFlopTree(makeConfig(), [10, 10]);

  it('아웃오브포지션이 먼저 행동한다', () => {
    const root = tree.nodes[tree.root]!;
    expect(root.kind).toBe('action');
    if (root.kind !== 'action') return;
    expect(root.player).toBe(0);
  });

  it('아무도 베팅하지 않았으면 체크와 벳만 있다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    expect(root.actions[0]!.kind).toBe('check');
    expect(root.actions.some((a) => a.kind === 'bet')).toBe(true);
    expect(root.actions.some((a) => a.kind === 'fold')).toBe(false);
  });

  it('베팅을 맞으면 폴드·콜·레이즈가 생긴다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const betIndex = root.actions.findIndex((a) => a.kind === 'bet');
    const afterBet = tree.nodes[root.children[betIndex]!]!;
    expect(afterBet.kind).toBe('action');
    if (afterBet.kind !== 'action') return;
    expect(afterBet.player).toBe(1);
    expect(afterBet.actions.map((a) => a.kind)).toContain('fold');
    expect(afterBet.actions.map((a) => a.kind)).toContain('call');
  });

  it('양쪽이 체크하면 쇼다운이다', () => {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return;
    const afterCheck = tree.nodes[root.children[0]!]!;
    if (afterCheck.kind !== 'action') throw new Error('IP 노드가 아님');
    const showdown = tree.nodes[afterCheck.children[0]!]!;
    expect(showdown.kind).toBe('terminal');
    if (showdown.kind !== 'terminal') return;
    expect(showdown.terminal).toBe('showdown');
    expect(showdown.pot).toBe(6); // 아무도 안 걸었으니 시작 팟 그대로
  });

  it('같은 사람이 연속으로 행동하지 않는다', () => {
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      for (const childIndex of node.children) {
        const child = tree.nodes[childIndex]!;
        if (child.kind !== 'action') continue;
        expect(child.player).not.toBe(node.player);
      }
    }
  });

  it('레이즈 횟수 상한을 지킨다', () => {
    // maxRaises=2면 벳 → 레이즈 이후로는 콜/폴드만 남아야 한다
    let node = tree.nodes[tree.root]!;
    let raises = 0;
    while (node.kind === 'action') {
      const index = node.actions.findIndex(
        (a) => a.kind === 'bet' || a.kind === 'raise' || a.kind === 'allin',
      );
      if (index < 0) break;
      raises++;
      node = tree.nodes[node.children[index]!]!;
    }
    expect(raises).toBeLessThanOrEqual(DEFAULT_FLOP_CONFIG.maxRaises + 1);
  });
});

describe('플롭 에퀴티 행렬', () => {
  it('압도적인 상황을 제대로 잡는다', () => {
    // 보드에 A가 깔린 상태에서 AA(셋)와 KK(오버페어 아님)
    const board = parseCards('Ah7d2c');
    const hero = collectLiveCombos(handRangeToCombos(parseRange('AA')), board);
    const villain = collectLiveCombos(handRangeToCombos(parseRange('KK')), board);
    const equity = buildFlopEquityMatrix(hero, villain, board);

    let sum = 0;
    let count = 0;
    for (let i = 0; i < hero.count; i++) {
      for (let j = 0; j < villain.count; j++) {
        sum += equity[i * villain.count + j]!;
        count++;
      }
    }
    const average = (sum / count) * 100;
    console.log(`Ah7d2c에서 AA(셋) vs KK — ${average.toFixed(1)}%`);
    expect(average).toBeGreaterThan(95);
  });

  it('플러시드로가 있는 쪽이 유리해진다', () => {
    // 스페이드 두 장 보드에서 스페이드를 든 쪽이 낫다
    const board = parseCards('Ks8s3d');
    const withDraw = collectLiveCombos(handRangeToCombos(parseRange('AQs')), board);
    const withoutDraw = collectLiveCombos(handRangeToCombos(parseRange('AQo')), board);
    const villain = collectLiveCombos(handRangeToCombos(parseRange('99')), board);

    const avg = (hero: typeof withDraw) => {
      const equity = buildFlopEquityMatrix(hero, villain, board);
      let sum = 0;
      for (let k = 0; k < equity.length; k++) sum += equity[k]!;
      return (sum / equity.length) * 100;
    };

    const suited = avg(withDraw);
    const offsuit = avg(withoutDraw);
    console.log(`Ks8s3d에서 vs 99 — AQs ${suited.toFixed(1)}% · AQo ${offsuit.toFixed(1)}%`);
    expect(suited).toBeGreaterThan(offsuit);
  });
});

describe('플롭 CFR', () => {
  it('두 사람의 평균 EV 합이 시작 팟과 같다', () => {
    // 제로섬. 플롭에서 오간 돈은 둘 사이에서만 움직이므로 합은 항상 시작 팟이다.
    const { hero, villain, equity, tree, config } = setup(
      'Kh8d3c',
      'QQ+, AKs, AQs, KQs, 88, 33',
      '99-22, ATs+, KJs+, QJs, JTs, T9s',
    );
    const result = solveFlop(tree, { iterations: 300, hero, villain, equity });
    const total = result.meanEv[0] + result.meanEv[1];
    console.log(
      `EV 합 ${total.toFixed(3)}bb (시작 팟 ${config.pot}bb) · ` +
        `OOP ${result.meanEv[0].toFixed(2)} / IP ${result.meanEv[1].toFixed(2)}`,
    );
    expect(total).toBeCloseTo(config.pot, 1);
  });

  it('레인지가 압도적으로 강하면 팟을 거의 다 가져간다', () => {
    // 보드에 셋을 맞춘 레인지 vs 아무것도 없는 레인지
    const { hero, villain, equity, tree, config } = setup('Kh8d3c', 'KK, 88, 33', '76s, 65s, 54s');
    const result = solveFlop(tree, { iterations: 300, hero, villain, equity });
    console.log(
      `압도 상황 — 강한 쪽 ${result.meanEv[0].toFixed(2)}bb / 약한 쪽 ${result.meanEv[1].toFixed(2)}bb`,
    );
    expect(result.meanEv[0]).toBeGreaterThan(config.pot * 0.8);
  });

  it('반복을 늘려도 EV 합은 유지된다', () => {
    const { hero, villain, equity, tree, config } = setup(
      'Ts9s2h',
      'AA, KK, AKs, JJ',
      'QQ, JJ, TT, 99, AQs, KQs',
    );
    for (const iterations of [50, 400]) {
      const result = solveFlop(tree, { iterations, hero, villain, equity });
      expect(result.meanEv[0] + result.meanEv[1]).toBeCloseTo(config.pot, 1);
    }
  });

  it('전략의 액션 빈도 합이 1이다', () => {
    const { hero, villain, equity, tree } = setup(
      'Kh8d3c',
      'QQ+, AKs',
      '99-22, ATs+, KJs+',
    );
    const result = solveFlop(tree, { iterations: 200, hero, villain, equity });

    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      const n = node.player === 0 ? hero.count : villain.count;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let a = 0; a < node.actions.length; a++) {
          sum += result.strategy[node.offset + a * n + i]!;
        }
        expect(sum, `노드 ${node.index} 콤보 ${i}`).toBeCloseTo(1, 3);
      }
    }
  });

  it('강한 핸드가 약한 핸드보다 EV가 높다', () => {
    const { hero, villain, equity, tree } = setup('Kh8d3c', 'KK, 72o', '99-22, ATs+');
    const result = solveFlop(tree, { iterations: 400, hero, villain, equity });

    // hero 레인지에서 KK(셋)의 EV가 72o보다 확실히 높아야 한다
    let bestKk = -Infinity;
    let worstTrash = Infinity;
    for (let i = 0; i < hero.count; i++) {
      const a = hero.cardA[i]!;
      const b = hero.cardB[i]!;
      const isKing = (a >> 2) === 11 && (b >> 2) === 11;
      if (isKing) bestKk = Math.max(bestKk, result.ev[0][i]!);
      else worstTrash = Math.min(worstTrash, result.ev[0][i]!);
    }
    console.log(`Kh8d3c — KK(셋) EV ${bestKk.toFixed(2)}bb · 72o EV ${worstTrash.toFixed(2)}bb`);
    expect(bestKk).toBeGreaterThan(worstTrash);
  });
});

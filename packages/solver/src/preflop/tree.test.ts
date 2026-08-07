import { describe, expect, it } from 'vitest';
import { DEFAULT_6MAX_100BB } from './config';
import { buildPreflopTree } from './tree';

describe('프리플롭 트리', () => {
  const tree = buildPreflopTree(DEFAULT_6MAX_100BB);

  it('크기를 보고한다', () => {
    const bytes = tree.strategySize * 4 * 2; // regret + strategySum
    console.log(
      `노드 ${tree.nodes.length} (액션 ${tree.actionNodeCount} / 터미널 ${tree.terminalNodeCount}) ` +
        `· 전략 슬롯 ${tree.strategySize.toLocaleString()} · 메모리 ${(bytes / 1024 / 1024).toFixed(1)}MB`,
    );
    expect(tree.nodes.length).toBeGreaterThan(0);
  });

  it('루트는 UTG가 폴드 아니면 오픈하는 자리다', () => {
    const root = tree.nodes[tree.root]!;
    expect(root.kind).toBe('action');
    if (root.kind !== 'action') return;
    expect(root.player).toBe(0);
    expect(root.actions.map((a) => a.kind)).toEqual(['fold', 'raise']);
    expect(root.actions[1]!.to).toBe(2.5);
  });

  it('전원 폴드하면 BB가 블라인드를 가져간다', () => {
    let node = tree.nodes[tree.root]!;
    // UTG~SB 다섯 명 연속 폴드
    for (let i = 0; i < 5; i++) {
      if (node.kind !== 'action') throw new Error(`${i}번째에서 액션 노드가 아님`);
      const foldIdx = node.actions.findIndex((a) => a.kind === 'fold');
      node = tree.nodes[node.children[foldIdx]!]!;
    }
    expect(node.kind).toBe('terminal');
    if (node.kind !== 'terminal') return;
    expect(node.terminal).toBe('uncontested');
    expect(node.contenders).toEqual([5]); // BB
    expect(node.pot).toBe(1.5);
  });

  it('오픈에 폴드로 돌면 오픈한 사람이 1.5bb를 딴다', () => {
    let node = tree.nodes[tree.root]!;
    if (node.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    // UTG 오픈
    node = tree.nodes[node.children[node.actions.findIndex((a) => a.kind === 'raise')]!]!;
    // 나머지 다섯 명 폴드
    for (let i = 0; i < 5; i++) {
      if (node.kind !== 'action') throw new Error(`${i}번째에서 액션 노드가 아님`);
      const foldIdx = node.actions.findIndex((a) => a.kind === 'fold');
      expect(foldIdx).toBeGreaterThanOrEqual(0);
      node = tree.nodes[node.children[foldIdx]!]!;
    }
    expect(node.kind).toBe('terminal');
    if (node.kind !== 'terminal') return;
    expect(node.terminal).toBe('uncontested');
    expect(node.contenders).toEqual([0]);
    expect(node.pot).toBe(4); // 2.5 오픈 + 0.5 SB + 1 BB
  });

  it('3벳 사이즈가 포지션 관계를 반영한다', () => {
    // UTG 오픈 2.5 → BTN(IP) 3벳은 7.5, SB(OOP) 3벳은 10
    let node = tree.nodes[tree.root]!;
    if (node.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
    node = tree.nodes[node.children[node.actions.findIndex((a) => a.kind === 'raise')]!]!;

    // HJ, CO 폴드
    for (let i = 0; i < 2; i++) {
      if (node.kind !== 'action') throw new Error('액션 노드가 아님');
      node = tree.nodes[node.children[0]!]!;
    }
    // BTN 차례
    if (node.kind !== 'action') throw new Error('BTN 노드가 아님');
    expect(node.player).toBe(3);
    const btnRaise = node.actions.find((a) => a.kind === 'raise');
    expect(btnRaise?.to).toBe(7.5); // IP 3배

    // BTN 폴드 → SB 차례
    node = tree.nodes[node.children[0]!]!;
    if (node.kind !== 'action') throw new Error('SB 노드가 아님');
    expect(node.player).toBe(4);
    const sbRaise = node.actions.find((a) => a.kind === 'raise');
    expect(sbRaise?.to).toBe(10); // OOP 4배
  });

  it('레이즈는 5벳에서 멈추고 그 위는 올인이다', () => {
    let maxRaise = 0;
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      maxRaise = Math.max(maxRaise, node.raiseCount);
      for (const a of node.actions) {
        if (a.kind === 'raise') expect(a.to).toBeLessThan(DEFAULT_6MAX_100BB.stack);
      }
    }
    expect(maxRaise).toBeLessThanOrEqual(4);
  });

  it('모든 액션 노드가 최소 2개 선택지를 가진다', () => {
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      expect(node.actions.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('터미널 노드의 팟은 투자액 합과 같다', () => {
    for (const node of tree.nodes) {
      if (node.kind !== 'terminal') continue;
      const total = node.invested.reduce((a, b) => a + b, 0);
      expect(node.pot).toBeCloseTo(total, 6);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_6MAX_100BB } from './config';
import { makeSpotDefinition } from './solve';
import { buildSpotTree, type SpotActionNode, type SpotTree } from './spot';

/**
 * 스팟 트리의 모양을 검증한다.
 *
 * 여기서 한 칸이라도 어긋나면 CFR은 "말이 되지만 틀린" 답을 낸다. 크래시가 안 나서
 * 눈치채기 어렵고, 화면에 그럴듯한 숫자가 뜬 뒤에야 발견된다.
 * 실제로 opener의 acted를 빠뜨려서 BB의 콜 레인지가 통째로 사라진 적이 있다.
 */

const config = DEFAULT_6MAX_100BB;

function actionNode(tree: SpotTree, index: number): SpotActionNode {
  const node = tree.nodes[index]!;
  if (node.kind !== 'action') throw new Error(`액션 노드가 아님: ${index}`);
  return node;
}

function childByKind(tree: SpotTree, node: SpotActionNode, kind: string) {
  const index = node.actions.findIndex((a) => a.kind === kind);
  if (index < 0) throw new Error(`${kind} 액션이 없음`);
  return tree.nodes[node.children[index]!]!;
}

describe('오픈에 대응하는 스팟', () => {
  const tree = buildSpotTree(makeSpotDefinition('UTG', 'BB', config), config);
  const root = actionNode(tree, tree.root);

  it('BB가 먼저 행동하고 선택지는 폴드·콜·3벳이다', () => {
    expect(tree.positions).toEqual(['BB', 'UTG']);
    expect(root.player).toBe(0);
    expect(root.actions.map((a) => a.kind)).toEqual(['fold', 'call', 'raise']);
  });

  it('콜하면 곧바로 플롭으로 간다', () => {
    // 여기가 핵심이다. 오픈한 사람은 이미 행동했으므로 콜에 라운드가 끝나야 한다.
    // 이게 깨지면 UTG가 같은 라운드에서 또 올리는 노드가 생긴다.
    const afterCall = childByKind(tree, root, 'call');
    expect(afterCall.kind).toBe('terminal');
    if (afterCall.kind !== 'terminal') return;
    expect(afterCall.terminal).toBe('postflop');
    // 팟 = 양쪽 2.5씩 + SB가 두고 간 0.5
    expect(afterCall.pot).toBeCloseTo(5.5, 6);
  });

  it('BB가 폴드하면 UTG가 판을 가져간다', () => {
    const afterFold = childByKind(tree, root, 'fold');
    expect(afterFold.kind).toBe('terminal');
    if (afterFold.kind !== 'terminal') return;
    expect(afterFold.terminal).toBe('fold');
    expect(afterFold.winner).toBe(1); // UTG
    expect(afterFold.pot).toBeCloseTo(4, 6); // 2.5 + 1 + 0.5
  });

  it('3벳을 하면 그때는 UTG가 다시 행동한다', () => {
    const afterThreeBet = childByKind(tree, root, 'raise');
    expect(afterThreeBet.kind).toBe('action');
    if (afterThreeBet.kind !== 'action') return;
    expect(afterThreeBet.player).toBe(1); // UTG
    expect(afterThreeBet.actions.map((a) => a.kind)).toEqual(['fold', 'call', 'raise']);
  });

  it('UTG가 3벳을 콜하면 거기서 플롭으로 간다', () => {
    const afterThreeBet = actionNode(tree, childByKind(tree, root, 'raise').index);
    const afterCall = childByKind(tree, afterThreeBet, 'call');
    expect(afterCall.kind).toBe('terminal');
    if (afterCall.kind !== 'terminal') return;
    expect(afterCall.terminal).toBe('postflop');
  });

  it('레이즈가 오갈 때마다 상대에게 차례가 돌아온다', () => {
    // 3벳 → 4벳 → 5벳(올인) → 콜/폴드 순으로 번갈아 나와야 한다.
    let node: SpotActionNode = root;
    const seen: number[] = [];
    for (let depth = 0; depth < 4; depth++) {
      seen.push(node.player);
      const next = node.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
      if (next < 0) break;
      const child = tree.nodes[node.children[next]!]!;
      if (child.kind !== 'action') break;
      node = child;
    }
    // 같은 사람이 연달아 두 번 행동하면 안 된다
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `${i}번째 액션 노드`).not.toBe(seen[i - 1]);
    }
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});

describe('아직 아무도 레이즈하지 않은 스팟', () => {
  it('둘 다 행동 전이라 first가 열 수 있다', () => {
    // 숏스택 헤즈업. raiseCount가 0이면 블라인드만 놓인 상태다.
    const tree = buildSpotTree(
      {
        first: 'SB',
        second: 'BB',
        deadMoney: 0,
        invested: [0.5, 1],
        raiseCount: 0,
        label: '테스트',
      },
      { ...config, stack: 10, openSize: { ...config.openSize, SB: 10 }, allInThreshold: 0.5 },
    );
    const root = actionNode(tree, tree.root);
    expect(root.player).toBe(0);
    expect(root.actions.map((a) => a.kind)).toEqual(['fold', 'allin']);

    // SB가 올인하면 BB가 받거나 접는다
    const afterPush = childByKind(tree, root, 'allin');
    expect(afterPush.kind).toBe('action');
    if (afterPush.kind !== 'action') return;
    expect(afterPush.player).toBe(1);
  });
});

describe('모든 스팟의 공통 성질', () => {
  const pairs: Array<[Parameters<typeof makeSpotDefinition>[0], Parameters<typeof makeSpotDefinition>[1]]> =
    [
      ['UTG', 'HJ'],
      ['UTG', 'BB'],
      ['CO', 'BTN'],
      ['BTN', 'BB'],
      ['SB', 'BB'],
    ];

  it('콜은 언제나 판을 끝낸다 (플롭이거나 쇼다운)', () => {
    for (const [opener, responder] of pairs) {
      const tree = buildSpotTree(makeSpotDefinition(opener, responder, config), config);
      for (const node of tree.nodes) {
        if (node.kind !== 'action') continue;
        const callIndex = node.actions.findIndex((a) => a.kind === 'call');
        if (callIndex < 0) continue;
        const child = tree.nodes[node.children[callIndex]!]!;
        expect(child.kind, `${opener} vs ${responder}: 콜 다음이 액션 노드`).toBe('terminal');
      }
    }
  });

  it('같은 사람이 연속으로 행동하지 않는다', () => {
    for (const [opener, responder] of pairs) {
      const tree = buildSpotTree(makeSpotDefinition(opener, responder, config), config);
      for (const node of tree.nodes) {
        if (node.kind !== 'action') continue;
        for (const childIndex of node.children) {
          const child = tree.nodes[childIndex]!;
          if (child.kind !== 'action') continue;
          expect(child.player, `${opener} vs ${responder}`).not.toBe(node.player);
        }
      }
    }
  });

  it('터미널 팟이 양쪽 투자액과 데드머니의 합이다', () => {
    for (const [opener, responder] of pairs) {
      const definition = makeSpotDefinition(opener, responder, config);
      const tree = buildSpotTree(definition, config);
      for (const node of tree.nodes) {
        if (node.kind !== 'terminal') continue;
        const expected = node.invested[0] + node.invested[1] + definition.deadMoney;
        expect(node.pot, `${opener} vs ${responder}`).toBeCloseTo(expected, 6);
      }
    }
  });
});

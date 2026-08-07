import { NUM_HANDS, comboToHandIndex, handIndexToString } from '@holdem/poker-core';
import type { FlopActionNode, FlopTree } from '@holdem/solver';

import type { AdviceOption } from './scenario';
import type { FlopSolution } from './use-flop';

/**
 * 플롭 솔버 결과를 화면이 쓰는 모양으로 바꾼다.
 *
 * 엔진은 콤보(AsKs, AhKh…) 단위로 답을 내지만 사람은 169칸으로 본다.
 * 다만 **플롭에서는 콤보끼리 답이 다르다** — 보드에 스페이드가 두 장이면
 * AsKs는 플러시드로가 있고 AhKh는 없다. 그래서 칸에 평균을 보여주되,
 * 특정 패를 고르면 그 콤보의 진짜 답을 따로 보여준다.
 */

/**
 * 액션 이름.
 *
 * 벳·레이즈는 **반드시 금액을 붙인다.** 사이즈가 둘 이상이면 "벳 79% / 벳 21%"처럼
 * 같은 이름이 두 줄 뜨는데, 그러면 어느 쪽이 어느 벳인지 알 방법이 없다.
 */
export function flopActionName(kind: string, amount?: number): string {
  const size = amount !== undefined && amount > 0 ? ` ${fmt(amount)}bb` : '';
  switch (kind) {
    case 'check':
      return '체크';
    case 'bet':
      return `벳${size}`;
    case 'call':
      return `콜${size}`;
    case 'fold':
      return '폴드';
    case 'raise':
      return `레이즈${size}`;
    case 'allin':
      return `올인${size}`;
    default:
      return kind;
  }
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

const KIND_MAP: Record<string, AdviceOption['kind']> = {
  check: 'check',
  bet: 'raise',
  call: 'call',
  fold: 'fold',
  raise: 'raise',
  allin: 'allin',
};

/** 매트릭스 한 칸의 색을 정하는 데 쓰는 액션별 평균 빈도. */
export function gridOptions(
  solution: FlopSolution,
  node: FlopActionNode,
): (handIndex: number) => AdviceOption[] | null {
  const player = node.player;
  const combos = solution.combos[player];
  const n = combos.length;

  // 169칸별로 그 칸에 속한 콤보들의 빈도를 모아 평균 낸다.
  const sums: Float64Array[] = node.actions.map(() => new Float64Array(NUM_HANDS));
  const counts = new Float64Array(NUM_HANDS);

  for (let i = 0; i < n; i++) {
    const hand = comboToHandIndex(combos[i]!);
    counts[hand]++;
    for (let a = 0; a < node.actions.length; a++) {
      sums[a]![hand] += solution.strategy[node.offset + a * n + i]!;
    }
  }

  return (handIndex: number) => {
    if (counts[handIndex] === 0) return null;
    return node.actions.map((action, a) => ({
      kind: KIND_MAP[action.kind] ?? 'check',
      name: flopActionName(action.kind, action.amount),
      detail: action.label,
      frequency: sums[a]![handIndex]! / counts[handIndex]!,
      amount: action.amount,
    }));
  };
}

export interface FlopHandAdvice {
  options: AdviceOption[];
  primary: AdviceOption;
  isMixed: boolean;
  headline: string;
  subline: string;
  ev: number;
  /** 같은 169칸 안에서도 콤보마다 답이 갈리는가. 플롭에서만 생기는 현상이다. */
  comboVaries: boolean;
  comboLabel: string;
}

/** 특정 콤보 하나의 답. 매트릭스 칸이 아니라 실제로 들고 있는 두 장 기준이다. */
export function handAdvice(
  solution: FlopSolution,
  node: FlopActionNode,
  comboSlot: number,
): FlopHandAdvice | null {
  const player = node.player;
  const combos = solution.combos[player];
  const n = combos.length;
  if (comboSlot < 0 || comboSlot >= n) return null;

  const options: AdviceOption[] = node.actions.map((action, a) => ({
    kind: KIND_MAP[action.kind] ?? 'check',
    name: flopActionName(action.kind, action.amount),
    detail: action.label,
    frequency: solution.strategy[node.offset + a * n + comboSlot]!,
    amount: action.amount,
  }));

  const sorted = [...options].sort((a, b) => b.frequency - a.frequency);
  const primary = sorted[0]!;
  const isMixed = sorted.filter((o) => o.frequency >= 0.08).length > 1;

  const handIndex = comboToHandIndex(combos[comboSlot]!);

  return {
    options: sorted,
    primary,
    isMixed,
    headline: isMixed ? `주로 ${primary.name}` : `${primary.name}하세요`,
    subline: isMixed
      ? `섞어 치는 패입니다 — ${sorted
          .filter((o) => o.frequency >= 0.08)
          .map((o) => `${o.name} ${Math.round(o.frequency * 100)}%`)
          .join(' · ')}`
      : `이 패는 항상 ${primary.name}입니다. ${primary.detail}.`,
    ev: solution.ev[player][comboSlot]!,
    comboVaries: comboSpread(solution, node, handIndex) > 0.15,
    comboLabel: handIndexToString(handIndex),
  };
}

/**
 * 같은 169칸 안에서 콤보별 전략이 얼마나 갈리는지.
 *
 * 프리플롭에서는 항상 0이지만 플롭에서는 흔하다. 무늬가 보드와 맞물리는지에 따라
 * 완전히 다른 패가 되기 때문이다. 값이 크면 화면에서 "같은 AK라도 무늬에 따라
 * 다르다"고 알려줘야 한다.
 */
function comboSpread(solution: FlopSolution, node: FlopActionNode, handIndex: number): number {
  const player = node.player;
  const combos = solution.combos[player];
  const n = combos.length;

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (comboToHandIndex(combos[i]!) !== handIndex) continue;
    const first = solution.strategy[node.offset + i]!;
    min = Math.min(min, first);
    max = Math.max(max, first);
  }
  return max - min === -Infinity ? 0 : Math.max(0, max - min);
}

/** 액션 경로를 사람이 읽는 문장으로. "체크 → 벳 4bb → 콜" */
export function describeLine(tree: FlopTree, line: readonly number[]): string {
  const parts: string[] = [];
  let index = tree.root;
  for (const actionIndex of line) {
    const node = tree.nodes[index]!;
    if (node.kind !== 'action') break;
    const action = node.actions[actionIndex];
    if (!action) break;
    parts.push(`${node.player === 0 ? '앞사람' : '뒷사람'} ${action.label}`);
    index = node.children[actionIndex]!;
  }
  return parts.length > 0 ? parts.join(' → ') : '플롭이 깔린 직후';
}

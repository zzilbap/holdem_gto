import type { LiveCombos } from './board';
import type { FlopTerminalNode, FlopTree } from './tree';

/**
 * 플롭 CFR.
 *
 * 프리플롭과 구조는 같지만 다루는 단위가 다르다. 프리플롭은 169칸이면 됐지만
 * 플롭부터는 콤보 단위여야 한다 — 보드가 스페이드 두 장이면 AsKs와 AhKh는
 * 완전히 다른 핸드이기 때문이다.
 *
 * 속도의 관건은 콤보 수다. 보드와 겹치지 않고 레인지에 실제로 있는 것만 남기면
 * 보통 300~500개가 되고, 터미널 노드 계산이 1326²(176만)에서 300²(9만)으로 줄어든다.
 */

export interface FlopSolveOptions {
  iterations: number;
  hero: LiveCombos;
  villain: LiveCombos;
  /** equity[i * villain.count + j] — 플롭 이후 hero 콤보 i의 승률. */
  equity: Float32Array;
  onProgress?: (iteration: number, total: number) => void;
  shouldStop?: () => boolean;
}

export interface FlopSolveResult {
  strategy: Float32Array;
  /** 각 플레이어의 콤보별 EV(bb). 자기 레인지 인덱스 기준이다. */
  ev: [Float32Array, Float32Array];
  /** 레인지 전체의 평균 EV(bb). 실현율을 재는 값이 바로 이것이다. */
  meanEv: [number, number];
  iterations: number;
}

export function solveFlop(tree: FlopTree, options: FlopSolveOptions): FlopSolveResult {
  const { iterations, hero, villain, equity } = options;
  const counts: [number, number] = [hero.count, villain.count];
  const players: [LiveCombos, LiveCombos] = [hero, villain];

  if (tree.comboCounts[0] !== hero.count || tree.comboCounts[1] !== villain.count) {
    throw new Error(
      `트리는 콤보 [${tree.comboCounts}]로 만들어졌는데 레인지는 ` +
        `[${hero.count}, ${villain.count}]입니다.`,
    );
  }

  const regret = new Float32Array(tree.strategySize);
  const strategySum = new Float32Array(tree.strategySize);

  /**
   * 카드가 겹치는 조합은 존재할 수 없다. 매번 네 번씩 비교하는 대신 미리 표로 만든다.
   * 300×500이면 15만 바이트라 메모리는 문제가 안 되고, 터미널 계산에서 분기가 사라진다.
   */
  const collision = buildCollisionMask(hero, villain);

  let completed = 0;
  for (let iter = 0; iter < iterations; iter++) {
    if (options.shouldStop?.()) break;

    for (const me of [0, 1] as const) {
      traverse(tree.root, players[me].weight, players[1 - me].weight, me);
    }

    const t = iter + 1;
    const posDiscount = Math.pow(t, 1.5) / (Math.pow(t, 1.5) + 1);
    const stratDiscount = Math.pow(t / (t + 1), 2);
    for (let i = 0; i < regret.length; i++) {
      const v = regret[i];
      regret[i] = v > 0 ? v * posDiscount : v * 0.5;
      strategySum[i] *= stratDiscount;
    }

    completed = iter + 1;
    options.onProgress?.(completed, iterations);
  }

  const strategy = averageStrategy();
  const ev: [Float32Array, Float32Array] = [
    evaluateEv(0, strategy),
    evaluateEv(1, strategy),
  ];

  /**
   * 평균을 낼 때 콤보의 비중만 쓰면 안 된다.
   *
   * 콤보마다 상대와 실제로 성립 가능한 조합 수가 다르기 때문이다 —
   * 보드에 K가 있으면 KK를 든 사람은 상대가 가질 수 있는 K 조합이 줄어든다.
   * 이 무게를 빼먹으면 두 사람의 평균 EV 합이 시작 팟과 어긋난다(실측 0.22bb).
   */
  const pairWeight: [Float32Array, Float32Array] = [
    pairableMass(0),
    pairableMass(1),
  ];

  return {
    strategy,
    ev,
    meanEv: [weightedMean(ev[0], pairWeight[0]), weightedMean(ev[1], pairWeight[1])],
    iterations: completed,
  };

  // -------------------------------------------------------------------------

  function traverse(
    nodeIndex: number,
    reachMe: Float32Array,
    reachOpp: Float32Array,
    me: 0 | 1,
  ): Float32Array {
    const node = tree.nodes[nodeIndex]!;
    if (node.kind === 'terminal') return terminalValue(node, reachOpp, me);

    const n = counts[me];
    const actionCount = node.actions.length;

    if (node.player === me) {
      const strat = currentStrategy(node.offset, actionCount, n);
      const actionValues: Float32Array[] = [];
      for (let a = 0; a < actionCount; a++) {
        const next = new Float32Array(n);
        const base = a * n;
        for (let i = 0; i < n; i++) next[i] = reachMe[i] * strat[base + i];
        actionValues.push(traverse(node.children[a]!, next, reachOpp, me));
      }

      const nodeValue = new Float32Array(n);
      for (let a = 0; a < actionCount; a++) {
        const av = actionValues[a]!;
        const base = a * n;
        for (let i = 0; i < n; i++) nodeValue[i] += strat[base + i] * av[i];
      }

      for (let a = 0; a < actionCount; a++) {
        const av = actionValues[a]!;
        const slot = node.offset + a * n;
        const base = a * n;
        for (let i = 0; i < n; i++) {
          regret[slot + i] += av[i] - nodeValue[i];
          strategySum[slot + i] += reachMe[i] * strat[base + i];
        }
      }
      return nodeValue;
    }

    // 상대 차례. 상대 전략을 상대 도달확률에 녹여 내려보낸다.
    const oppCount = counts[1 - me];
    const strat = currentStrategy(node.offset, actionCount, oppCount);
    const total = new Float32Array(n);
    for (let a = 0; a < actionCount; a++) {
      const next = new Float32Array(oppCount);
      const base = a * oppCount;
      for (let j = 0; j < oppCount; j++) next[j] = reachOpp[j] * strat[base + j];
      const sub = traverse(node.children[a]!, reachMe, next, me);
      for (let i = 0; i < n; i++) total[i] += sub[i];
    }
    return total;
  }

  function terminalValue(
    node: FlopTerminalNode,
    reachOpp: Float32Array,
    me: 0 | 1,
  ): Float32Array {
    const n = counts[me];
    const m = counts[1 - me];
    const out = new Float32Array(n);
    const invested = node.invested[me];

    // 상대 레인지에서 살아있는 칸만 돈다. 베팅 라인이 깊어질수록 대부분 0이 된다.
    const live: number[] = [];
    for (let j = 0; j < m; j++) if (reachOpp[j] > 0) live.push(j);
    if (live.length === 0) return out;

    if (node.terminal === 'fold') {
      const payoff = node.winner === me ? node.pot - invested : -invested;
      for (let i = 0; i < n; i++) {
        let mass = 0;
        for (let k = 0; k < live.length; k++) {
          const j = live[k]!;
          if (isColliding(me, i, j)) continue;
          mass += reachOpp[j];
        }
        out[i] = payoff * mass;
      }
      return out;
    }

    // 쇼다운. equity 행렬은 hero(=0) 기준으로 만들어져 있으므로 방향을 맞춘다.
    for (let i = 0; i < n; i++) {
      let value = 0;
      for (let k = 0; k < live.length; k++) {
        const j = live[k]!;
        if (isColliding(me, i, j)) continue;
        const w = reachOpp[j];
        const share = me === 0 ? equity[i * m + j]! : 1 - equity[j * n + i]!;
        value += w * (node.pot * share - invested);
      }
      out[i] = value;
    }
    return out;
  }

  /** 콤보 i의 "실제로 성립 가능한 조합 무게" = 자기 비중 × 충돌하지 않는 상대 비중의 합. */
  function pairableMass(me: 0 | 1): Float32Array {
    const n = counts[me];
    const m = counts[1 - me];
    const oppWeight = players[1 - me].weight;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let mass = 0;
      for (let j = 0; j < m; j++) {
        if (isColliding(me, i, j)) continue;
        mass += oppWeight[j]!;
      }
      out[i] = players[me].weight[i]! * mass;
    }
    return out;
  }

  function isColliding(me: 0 | 1, mine: number, theirs: number): boolean {
    return me === 0
      ? collision[mine * villain.count + theirs] === 1
      : collision[theirs * villain.count + mine] === 1;
  }

  function currentStrategy(offset: number, actionCount: number, n: number): Float32Array {
    const out = new Float32Array(actionCount * n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let a = 0; a < actionCount; a++) {
        const r = regret[offset + a * n + i];
        if (r > 0) sum += r;
      }
      if (sum > 0) {
        for (let a = 0; a < actionCount; a++) {
          const r = regret[offset + a * n + i];
          out[a * n + i] = r > 0 ? r / sum : 0;
        }
      } else {
        const uniform = 1 / actionCount;
        for (let a = 0; a < actionCount; a++) out[a * n + i] = uniform;
      }
    }
    return out;
  }

  function averageStrategy(): Float32Array {
    const out = new Float32Array(tree.strategySize);
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      const n = counts[node.player];
      const actionCount = node.actions.length;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let a = 0; a < actionCount; a++) sum += strategySum[node.offset + a * n + i];
        if (sum > 1e-12) {
          for (let a = 0; a < actionCount; a++) {
            out[node.offset + a * n + i] = strategySum[node.offset + a * n + i] / sum;
          }
        } else {
          const uniform = 1 / actionCount;
          for (let a = 0; a < actionCount; a++) out[node.offset + a * n + i] = uniform;
        }
      }
    }
    return out;
  }

  /** 평균 전략으로 각 콤보의 EV를 다시 계산한다. */
  function evaluateEv(me: 0 | 1, strategy: Float32Array): Float32Array {
    const n = counts[me];
    const cfv = walk(tree.root, players[me].weight, players[1 - me].weight);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // counterfactual value를 상대 도달 총량으로 나눠 콤보당 값으로 되돌린다.
      let mass = 0;
      for (let j = 0; j < counts[1 - me]; j++) {
        if (isColliding(me, i, j)) continue;
        mass += players[1 - me].weight[j]!;
      }
      out[i] = mass > 1e-12 ? cfv[i] / mass : 0;
    }
    return out;

    function walk(nodeIndex: number, reachMe: Float32Array, reachOpp: Float32Array): Float32Array {
      const node = tree.nodes[nodeIndex]!;
      if (node.kind === 'terminal') return terminalValue(node, reachOpp, me);

      const actionCount = node.actions.length;
      const total = new Float32Array(n);
      for (let a = 0; a < actionCount; a++) {
        if (node.player === me) {
          const slot = node.offset + a * n;
          const next = new Float32Array(n);
          for (let i = 0; i < n; i++) next[i] = reachMe[i] * strategy[slot + i];
          const sub = walk(node.children[a]!, next, reachOpp);
          for (let i = 0; i < n; i++) total[i] += strategy[slot + i] * sub[i];
        } else {
          const oppCount = counts[1 - me];
          const slot = node.offset + a * oppCount;
          const next = new Float32Array(oppCount);
          for (let j = 0; j < oppCount; j++) next[j] = reachOpp[j] * strategy[slot + j];
          const sub = walk(node.children[a]!, reachMe, next);
          for (let i = 0; i < n; i++) total[i] += sub[i];
        }
      }
      return total;
    }
  }
}

function buildCollisionMask(hero: LiveCombos, villain: LiveCombos): Uint8Array {
  const mask = new Uint8Array(hero.count * villain.count);
  for (let i = 0; i < hero.count; i++) {
    const ai = hero.cardA[i]!;
    const bi = hero.cardB[i]!;
    const row = i * villain.count;
    for (let j = 0; j < villain.count; j++) {
      const aj = villain.cardA[j]!;
      const bj = villain.cardB[j]!;
      if (ai === aj || ai === bj || bi === aj || bi === bj) mask[row + j] = 1;
    }
  }
  return mask;
}

function weightedMean(values: Float32Array, weights: Float32Array): number {
  let sum = 0;
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]! * weights[i]!;
    total += weights[i]!;
  }
  return total > 0 ? sum / total : 0;
}

import { NUM_HANDS, combosOfHand } from '@holdem/poker-core';
import { isInPosition } from './config';
import { collisionMatrix } from './equity-table';
import { rangeWidthOf, type RealizationModel } from './realization';
import type { SpotTerminalNode, SpotTree } from './spot';

/**
 * 2인 스팟용 Discounted CFR.
 *
 * 리그렛과 전략 누적은 노드마다 배열을 만들지 않고 하나의 평평한 Float32Array에 담는다.
 *   regret[node.offset + action * 169 + hand]
 *
 * "169개 핸드를 한 번에" 처리하는 벡터화 CFR이다. 핸드를 하나씩 뽑는 방식(MCCFR)보다
 * 프리플롭처럼 인포셋이 작고 터미널이 무거운 문제에서 훨씬 빨리 수렴한다.
 */

export interface SolveOptions {
  iterations: number;
  /** 두 플레이어의 시작 레인지 (169칸, 0~1 비중). */
  ranges: [Float32Array, Float32Array];
  equityTable: Float32Array;
  realization: RealizationModel;
  /** 진행 상황 콜백. Worker에서 UI로 퍼센트를 흘려보낼 때 쓴다. */
  onProgress?: (iteration: number, total: number) => void;
  /** true를 반환하면 즉시 멈춘다. 사용자가 설정을 바꿔 재계산을 시작할 때. */
  shouldStop?: () => boolean;
  /**
   * 각 플레이어가 **실제로 상대하게 될 레인지의 폭**(0~1).
   *
   * 실현율 보정에 쓴다. 시작 레인지를 그대로 쓰면 안 되는 경우가 있다:
   * 오프너 입장에서 상대는 "전 레인지"가 아니라 "폴드하지 않고 따라온 30~40%"다.
   * 100%로 잡으면 오프너가 과도하게 유리해져 RFI가 폭발한다(실측: BTN 70%).
   * 생략하면 시작 레인지에서 계산한다.
   */
  villainWidths?: [number, number];
}

export interface SolveResult {
  /** 노드별·액션별 평균 전략. strategy[node.offset + a * 169 + h] */
  strategy: Float32Array;
  /** 각 플레이어의 핸드별 루트 EV(bb). 화면에 띄우는 "이 핸드의 기댓값". */
  rootEv: [Float32Array, Float32Array];
  iterations: number;
  /** 남은 평균 리그렛(bb). 0에 가까울수록 균형에 가깝다. */
  residualRegret: number;
  /**
   * 루트에서 갈라지는 액션별로 쪼갠 결과.
   *
   * RFI 레인지를 구할 때 필요하다. "UTG가 오픈했는데 BB가 폴드하지 않았다면 그때
   * UTG의 EV는 얼마인가"를 알아야 여러 명이 순차로 반응하는 상황을 조립할 수 있다.
   * 루트에서 행동하지 않는 쪽(= 이미 오픈한 쪽)의 관점이다.
   */
  rootBreakdown: RootActionBreakdown | null;
}

export interface RootActionBreakdown {
  /** 루트에서 행동하는 플레이어. */
  actor: 0 | 1;
  /** actor의 액션 a를 고를 확률 — 상대가 핸드 h를 들고 있다는 조건 하에서. */
  probability: Float32Array[];
  /** 액션 a가 나왔을 때 상대(=actor가 아닌 쪽)의 조건부 EV(bb). */
  opponentEv: Float32Array[];
}

export function solveSpot(tree: SpotTree, options: SolveOptions): SolveResult {
  const { iterations, ranges, equityTable, realization } = options;
  const collision = collisionMatrix();

  const regret = new Float32Array(tree.strategySize);
  const strategySum = new Float32Array(tree.strategySize);

  const spr = computeSpr(tree);
  const realizationByPlayer = buildRealizationFactors();

  let completed = 0;
  for (let iter = 0; iter < iterations; iter++) {
    if (options.shouldStop?.()) break;

    for (const me of [0, 1] as const) {
      traverse(tree.root, ranges[me], ranges[1 - me], me);
    }

    // DCFR 할인. 초반의 엉터리 리그렛을 빠르게 잊게 만들어 수렴을 앞당긴다.
    const t = iter + 1;
    const posDiscount = Math.pow(t, DCFR_ALPHA) / (Math.pow(t, DCFR_ALPHA) + 1);
    const negDiscount = 0.5; // beta = 0 → 음수 리그렛은 매 반복 절반으로
    const stratDiscount = Math.pow(t / (t + 1), DCFR_GAMMA);

    for (let i = 0; i < regret.length; i++) {
      const v = regret[i];
      regret[i] = v > 0 ? v * posDiscount : v * negDiscount;
      strategySum[i] *= stratDiscount;
    }

    completed = iter + 1;
    options.onProgress?.(completed, iterations);
  }

  const strategy = averageStrategy();

  return {
    strategy,
    rootEv: [evaluateRootEv(0, strategy), evaluateRootEv(1, strategy)],
    iterations: completed,
    residualRegret: meanPositiveRegret(),
    rootBreakdown: computeRootBreakdown(strategy),
  };

  // -------------------------------------------------------------------------

  /**
   * `me`의 counterfactual value 벡터(169)를 반환한다.
   *
   * counterfactual이란 "내 도달확률은 빼고" 계산한다는 뜻이다. 그래서 반환값에는
   * reachMe가 곱해져 있지 않다. 이걸 헷갈리면 리그렛이 이중으로 가중돼 수렴이 깨진다.
   */
  function traverse(
    nodeIndex: number,
    reachMe: Float32Array,
    reachOpp: Float32Array,
    me: 0 | 1,
  ): Float32Array {
    const node = tree.nodes[nodeIndex]!;
    if (node.kind === 'terminal') return terminalValue(node, reachOpp, me);

    const actionCount = node.actions.length;
    const strat = currentStrategy(node.offset, actionCount);

    if (node.player === me) {
      const actionValues: Float32Array[] = [];
      for (let a = 0; a < actionCount; a++) {
        const next = new Float32Array(NUM_HANDS);
        const base = a * NUM_HANDS;
        for (let h = 0; h < NUM_HANDS; h++) next[h] = reachMe[h] * strat[base + h];
        actionValues.push(traverse(node.children[a]!, next, reachOpp, me));
      }

      const nodeValue = new Float32Array(NUM_HANDS);
      for (let a = 0; a < actionCount; a++) {
        const av = actionValues[a]!;
        const base = a * NUM_HANDS;
        for (let h = 0; h < NUM_HANDS; h++) nodeValue[h] += strat[base + h] * av[h];
      }

      // 리그렛 = "그 액션만 골랐다면 얼마나 더 벌었을까"의 누적
      for (let a = 0; a < actionCount; a++) {
        const av = actionValues[a]!;
        const slot = node.offset + a * NUM_HANDS;
        const base = a * NUM_HANDS;
        for (let h = 0; h < NUM_HANDS; h++) {
          regret[slot + h] += av[h] - nodeValue[h];
          strategySum[slot + h] += reachMe[h] * strat[base + h];
        }
      }
      return nodeValue;
    }

    // 상대 차례: 상대 전략을 상대 도달확률에 녹여 내려보내고 결과를 합친다.
    const total = new Float32Array(NUM_HANDS);
    for (let a = 0; a < actionCount; a++) {
      const next = new Float32Array(NUM_HANDS);
      const base = a * NUM_HANDS;
      for (let h = 0; h < NUM_HANDS; h++) next[h] = reachOpp[h] * strat[base + h];
      const sub = traverse(node.children[a]!, reachMe, next, me);
      for (let h = 0; h < NUM_HANDS; h++) total[h] += sub[h];
    }
    return total;
  }

  /**
   * 터미널 노드의 counterfactual value.
   *
   * 상대 레인지를 훑을 때 그냥 도달확률만 쓰지 않고 **collision 계수를 곱한다.**
   * "내가 AA면 상대 AA는 6콤보가 아니라 1콤보"라는 사실이 여기서 반영된다.
   * 이게 빠지면 블로커를 통째로 무시하게 되고 4벳/5벳 레인지가 눈에 띄게 틀어진다.
   */
  function terminalValue(node: SpotTerminalNode, reachOpp: Float32Array, me: 0 | 1): Float32Array {
    const out = new Float32Array(NUM_HANDS);
    const myInvested = node.invested[me];

    // 레인지는 보통 절반 이상이 비어 있다. 살아있는 칸만 돌면 2~3배 빨라진다.
    const live: number[] = [];
    for (let o = 0; o < NUM_HANDS; o++) if (reachOpp[o] > 0) live.push(o);
    if (live.length === 0) return out;

    if (node.terminal === 'fold') {
      // 카드를 보지 않고 끝나므로 결과가 핸드와 무관하다. 도달 총량만 곱하면 된다.
      const payoff = node.winner === me ? node.pot - myInvested : -myInvested;
      for (let h = 0; h < NUM_HANDS; h++) {
        const row = h * NUM_HANDS;
        let mass = 0;
        for (let k = 0; k < live.length; k++) {
          const o = live[k]!;
          mass += reachOpp[o] * collision[row + o];
        }
        out[h] = payoff * mass;
      }
      return out;
    }

    // 쇼다운이거나 플롭으로 넘어가는 경우. 플롭행일 때만 실현율을 곱한다.
    const useRealization = node.terminal === 'postflop';
    const rFactors = realizationByPlayer[me];

    for (let h = 0; h < NUM_HANDS; h++) {
      const row = h * NUM_HANDS;
      const r = useRealization ? rFactors[h] : 1;
      let value = 0;
      for (let k = 0; k < live.length; k++) {
        const o = live[k]!;
        const weight = reachOpp[o] * collision[row + o];
        if (weight === 0) continue;
        value += weight * (node.pot * equityTable[row + o] * r - myInvested);
      }
      out[h] = value;
    }
    return out;
  }

  /**
   * 두 플레이어의 실현율 표를 만든다.
   *
   * 각자 **상대 레인지의 폭**을 보고 값이 정해지므로 서로 다른 입력을 받는다.
   * 그런데 그대로 두면 두 값의 합이 2에서 벗어나고, 그만큼 팟에 없던 돈이
   * 생기거나 사라진다. 마지막에 합이 2가 되도록 맞춰준다.
   */
  function buildRealizationFactors(): [Float32Array, Float32Array] {
    const widths: [number, number] = options.villainWidths ?? [
      rangeWidthOf(ranges[1]),
      rangeWidthOf(ranges[0]),
    ];

    const raw: [Float32Array, Float32Array] = [
      realization.factors({
        inPosition: isInPosition(tree.positions[0], tree.positions[1]),
        spr,
        villainRangeWidth: widths[0],
      }),
      realization.factors({
        inPosition: isInPosition(tree.positions[1], tree.positions[0]),
        spr,
        villainRangeWidth: widths[1],
      }),
    ];

    // 콤보 가중 평균끼리 더해 2가 되도록 스칼라 보정. 핸드별 차이는 그대로 남는다.
    const mean0 = weightedMean(raw[0]);
    const mean1 = weightedMean(raw[1]);
    const total = mean0 + mean1;
    if (total <= 0) return raw;
    const scale = 2 / total;
    if (Math.abs(scale - 1) < 1e-6) return raw;

    return [scaled(raw[0], scale), scaled(raw[1], scale)];
  }

  /** 리그렛 매칭. 음수 리그렛은 버리고, 전부 0이면 균등 분포로 시작한다. */
  function currentStrategy(offset: number, actionCount: number): Float32Array {
    const out = new Float32Array(actionCount * NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) {
      let sum = 0;
      for (let a = 0; a < actionCount; a++) {
        const r = regret[offset + a * NUM_HANDS + h];
        if (r > 0) sum += r;
      }
      if (sum > 0) {
        for (let a = 0; a < actionCount; a++) {
          const r = regret[offset + a * NUM_HANDS + h];
          out[a * NUM_HANDS + h] = r > 0 ? r / sum : 0;
        }
      } else {
        const uniform = 1 / actionCount;
        for (let a = 0; a < actionCount; a++) out[a * NUM_HANDS + h] = uniform;
      }
    }
    return out;
  }

  /**
   * 답은 마지막 순간의 전략이 아니라 **반복 전체의 평균 전략**이다.
   * CFR이 균형으로 수렴한다고 할 때 수렴하는 대상이 이것이다.
   * 이걸 헷갈리면 진동하는 전략을 결과로 내놓게 된다.
   */
  function averageStrategy(): Float32Array {
    const out = new Float32Array(tree.strategySize);
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      const actionCount = node.actions.length;
      for (let h = 0; h < NUM_HANDS; h++) {
        let sum = 0;
        for (let a = 0; a < actionCount; a++) sum += strategySum[node.offset + a * NUM_HANDS + h];
        if (sum > 1e-12) {
          for (let a = 0; a < actionCount; a++) {
            out[node.offset + a * NUM_HANDS + h] =
              strategySum[node.offset + a * NUM_HANDS + h] / sum;
          }
        } else {
          const uniform = 1 / actionCount;
          for (let a = 0; a < actionCount; a++) out[node.offset + a * NUM_HANDS + h] = uniform;
        }
      }
    }
    return out;
  }

  /** 고정된 전략으로 서브트리를 훑어 `me`의 counterfactual value를 구한다. */
  function walkWithStrategy(
    nodeIndex: number,
    reachMe: Float32Array,
    reachOpp: Float32Array,
    me: 0 | 1,
    strategy: Float32Array,
  ): Float32Array {
    const node = tree.nodes[nodeIndex]!;
    if (node.kind === 'terminal') return terminalValue(node, reachOpp, me);

    const actionCount = node.actions.length;
    const total = new Float32Array(NUM_HANDS);
    for (let a = 0; a < actionCount; a++) {
      const slot = node.offset + a * NUM_HANDS;
      const next = new Float32Array(NUM_HANDS);
      if (node.player === me) {
        for (let h = 0; h < NUM_HANDS; h++) next[h] = reachMe[h] * strategy[slot + h];
        const sub = walkWithStrategy(node.children[a]!, next, reachOpp, me, strategy);
        // 내 차례에서는 자식 값을 **내 전략으로 가중 평균**한다. 그냥 더하면
        // counterfactual value에 이미 빠져 있는 내 확률이 액션 수만큼 부풀려진다.
        for (let h = 0; h < NUM_HANDS; h++) total[h] += strategy[slot + h] * sub[h];
      } else {
        for (let h = 0; h < NUM_HANDS; h++) next[h] = reachOpp[h] * strategy[slot + h];
        const sub = walkWithStrategy(node.children[a]!, reachMe, next, me, strategy);
        for (let h = 0; h < NUM_HANDS; h++) total[h] += sub[h];
      }
    }
    return total;
  }

  /** 내가 핸드 h를 들고 있을 때 상대 레인지가 갖는 총 콤보 질량. */
  function reachMass(hand: number, oppReach: Float32Array): number {
    const row = hand * NUM_HANDS;
    let mass = 0;
    for (let o = 0; o < NUM_HANDS; o++) mass += oppReach[o] * collision[row + o];
    return mass;
  }

  /** 평균 전략으로 루트 EV를 다시 계산해 "핸드당 bb"로 환산한다. */
  function evaluateRootEv(me: 0 | 1, strategy: Float32Array): Float32Array {
    const cfv = walkWithStrategy(tree.root, ranges[me], ranges[1 - me], me, strategy);
    const out = new Float32Array(NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) {
      // counterfactual value를 상대 도달 총량으로 나누면 핸드 하나당 기댓값이 된다.
      const mass = reachMass(h, ranges[1 - me]);
      out[h] = mass > 1e-12 ? cfv[h] / mass : 0;
    }
    return out;
  }

  /**
   * 루트에서 갈라지는 액션별로 "그 액션이 나올 확률"과 "그때 상대의 EV"를 뽑는다.
   *
   * 확률과 EV 모두 **상대 핸드에 조건부**다. 내가 AA를 들고 있으면 상대가 AA로
   * 3벳할 일이 줄어들기 때문에, 이 조건부를 무시하면 RFI 레인지가 틀어진다.
   */
  function computeRootBreakdown(strategy: Float32Array): RootActionBreakdown | null {
    const root = tree.nodes[tree.root]!;
    if (root.kind !== 'action') return null;

    const actor = root.player;
    const other = (1 - actor) as 0 | 1;
    const probability: Float32Array[] = [];
    const opponentEv: Float32Array[] = [];

    const totalMass = new Float32Array(NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) totalMass[h] = reachMass(h, ranges[actor]);

    for (let a = 0; a < root.actions.length; a++) {
      const slot = root.offset + a * NUM_HANDS;
      const actorReach = new Float32Array(NUM_HANDS);
      for (let h = 0; h < NUM_HANDS; h++) actorReach[h] = ranges[actor][h] * strategy[slot + h];

      const cfv = walkWithStrategy(root.children[a]!, ranges[other], actorReach, other, strategy);

      const prob = new Float32Array(NUM_HANDS);
      const ev = new Float32Array(NUM_HANDS);
      for (let h = 0; h < NUM_HANDS; h++) {
        const massA = reachMass(h, actorReach);
        prob[h] = totalMass[h] > 1e-12 ? massA / totalMass[h] : 0;
        ev[h] = massA > 1e-12 ? cfv[h] / massA : 0;
      }
      probability.push(prob);
      opponentEv.push(ev);
    }

    return { actor, probability, opponentEv };
  }

  /** 수렴 정도를 보는 값. 정확한 착취가능성이 필요하면 best-response 패스를 따로 붙인다. */
  function meanPositiveRegret(): number {
    let sum = 0;
    let count = 0;
    for (const node of tree.nodes) {
      if (node.kind !== 'action') continue;
      for (let a = 0; a < node.actions.length; a++) {
        for (let h = 0; h < NUM_HANDS; h++) {
          if (ranges[node.player][h] <= 0) continue;
          const r = regret[node.offset + a * NUM_HANDS + h];
          if (r > 0) sum += r;
          count++;
        }
      }
    }
    return count > 0 ? sum / count / Math.max(1, completed) : 0;
  }
}

const DCFR_ALPHA = 1.5;
const DCFR_GAMMA = 2;

function weightedMean(values: Float32Array): number {
  let sum = 0;
  for (let h = 0; h < NUM_HANDS; h++) sum += values[h] * combosOfHand(h).length;
  return sum / 1326;
}

function scaled(values: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] * factor;
  return out;
}

function computeSpr(tree: SpotTree): number {
  const { invested, deadMoney } = tree.definition;
  const pot = invested[0] + invested[1] + deadMoney;
  const effective = tree.config.stack - Math.max(invested[0], invested[1]);
  return pot > 0 ? effective / pot : 10;
}

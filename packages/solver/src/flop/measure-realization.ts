import {
  NUM_HANDS,
  comboToHandIndex,
  combosOfHand,
  type Card,
  type ComboRange,
} from '@holdem/poker-core';

import { buildFlopEquityMatrix, collectLiveCombos, type LiveCombos } from './board';
import { solveFlop } from './cfr';
import { buildFlopTree, type FlopConfig } from './tree';

/**
 * 에퀴티 실현율을 **재서** 구한다.
 *
 * 프리플롭 솔버는 "콜하고 플롭에 가면 얼마를 버나"를 알아야 하는데, 지금까지는
 * `에퀴티 × R`의 R을 추측한 공식으로 채웠다. 이제 플롭을 실제로 풀 수 있으니
 * 그 답을 직접 잰다.
 *
 *     R = (플롭을 실제로 쳐서 얻은 몫) ÷ (원래 가지고 있던 에퀴티)
 *
 * R이 1보다 작으면 "가진 에퀴티만큼도 못 챙겼다"는 뜻이다. 아웃오브포지션이거나
 * 맞아도 애매한 핸드에서 그렇게 된다.
 */

export interface RealizationSample {
  handIndex: number;
  /** 이 표본의 신뢰 무게. 콤보 비중 × 상대와 성립 가능한 조합 수. */
  weight: number;
  realization: number;
}

export interface BoardMeasurement {
  oop: RealizationSample[];
  ip: RealizationSample[];
}

export interface MeasureOptions {
  board: readonly Card[];
  oopRange: ComboRange;
  ipRange: ComboRange;
  config: FlopConfig;
  iterations: number;
  /**
   * 에퀴티가 이보다 낮은 콤보는 버린다.
   *
   * R은 에퀴티로 나눈 값이라 분모가 0에 가까우면 폭발한다. 에퀴티 2%짜리 핸드가
   * 우연히 4%를 챙기면 R이 2가 되는데, 이런 값이 평균을 통째로 망친다.
   */
  minEquity?: number;
}

export function measureRealizationOnBoard(options: MeasureOptions): BoardMeasurement {
  const { board, oopRange, ipRange, config, iterations } = options;
  const minEquity = options.minEquity ?? 0.08;

  const oop = collectLiveCombos(oopRange, board);
  const ip = collectLiveCombos(ipRange, board);
  if (oop.count === 0 || ip.count === 0) return { oop: [], ip: [] };

  const equity = buildFlopEquityMatrix(oop, ip, board);
  const tree = buildFlopTree(config, [oop.count, ip.count]);
  const result = solveFlop(tree, { iterations, hero: oop, villain: ip, equity });

  return {
    oop: extract(oop, ip, equity, result.ev[0], config.pot, false, minEquity),
    ip: extract(ip, oop, equity, result.ev[1], config.pot, true, minEquity),
  };
}

function extract(
  me: LiveCombos,
  them: LiveCombos,
  equity: Float32Array,
  ev: Float32Array,
  pot: number,
  isIp: boolean,
  minEquity: number,
): RealizationSample[] {
  const out: RealizationSample[] = [];

  for (let i = 0; i < me.count; i++) {
    const weight = me.weight[i]!;
    if (weight <= 0) continue;

    // 상대 레인지 대비 원래 에퀴티. 카드가 겹치는 조합은 빼고 센다.
    let equitySum = 0;
    let mass = 0;
    const ai = me.cardA[i]!;
    const bi = me.cardB[i]!;

    for (let j = 0; j < them.count; j++) {
      const aj = them.cardA[j]!;
      const bj = them.cardB[j]!;
      if (ai === aj || ai === bj || bi === aj || bi === bj) continue;
      const w = them.weight[j]!;
      if (w <= 0) continue;
      // equity 행렬은 항상 OOP 기준으로 만들어져 있다.
      const share = isIp ? 1 - equity[j * me.count + i]! : equity[i * them.count + j]!;
      equitySum += w * share;
      mass += w;
    }

    if (mass <= 0) continue;
    const rawEquity = equitySum / mass;
    if (rawEquity < minEquity) continue;

    // 플롭 솔버의 EV는 "플롭 시작 팟 기준 순이익"이다. 팟으로 나누면 몫의 비율이 된다.
    const realizedShare = ev[i]! / pot;
    out.push({
      handIndex: comboToHandIndex(me.indices[i]!),
      weight: weight * mass,
      realization: realizedShare / rawEquity,
    });
  }

  return out;
}

/**
 * 여러 보드에서 모은 표본을 169칸 표로 합친다.
 *
 * 표본이 없는 칸은 같은 모양(페어/수딧/오프수트)의 평균으로 메운다.
 * 그마저 없으면 전체 평균을 쓴다. 빈칸을 1로 두면 그 핸드만 실현율이 완벽하다는
 * 뜻이 되어 프리플롭 레인지에 이상한 구멍이 생긴다.
 */
export function aggregateRealization(samples: readonly RealizationSample[]): Float32Array {
  const sum = new Float64Array(NUM_HANDS);
  const weight = new Float64Array(NUM_HANDS);

  for (const sample of samples) {
    if (!Number.isFinite(sample.realization)) continue;
    sum[sample.handIndex] += sample.realization * sample.weight;
    weight[sample.handIndex] += sample.weight;
  }

  const shapeSum = new Float64Array(3);
  const shapeWeight = new Float64Array(3);
  let totalSum = 0;
  let totalWeight = 0;

  for (let h = 0; h < NUM_HANDS; h++) {
    if (weight[h] <= 0) continue;
    const bucket = shapeBucket(h);
    shapeSum[bucket] += sum[h];
    shapeWeight[bucket] += weight[h];
    totalSum += sum[h];
    totalWeight += weight[h];
  }

  const fallbackAll = totalWeight > 0 ? totalSum / totalWeight : 1;
  const out = new Float32Array(NUM_HANDS);

  for (let h = 0; h < NUM_HANDS; h++) {
    if (weight[h] > 0) {
      out[h] = sum[h] / weight[h];
      continue;
    }
    const bucket = shapeBucket(h);
    out[h] = shapeWeight[bucket] > 0 ? shapeSum[bucket] / shapeWeight[bucket] : fallbackAll;
  }

  return out;
}

function shapeBucket(handIndex: number): number {
  const combos = combosOfHand(handIndex).length;
  return combos === 6 ? 0 : combos === 4 ? 1 : 2;
}

/**
 * 두 표의 합이 2가 되도록 맞춘다.
 *
 * 측정값이라도 이 제약은 지켜야 한다. 실현 몫이 `에퀴티 × R`이고 에퀴티 합이 1이므로,
 * 합이 2를 벗어나면 팟에 없던 돈이 생기거나 사라진다. 측정 오차와 표본 편중이
 * 합을 조금씩 흔들기 때문에 마지막에 한 번 정규화한다.
 */
export function normalizePair(
  oop: Float32Array,
  ip: Float32Array,
): { oop: Float32Array; ip: Float32Array } {
  let oopSum = 0;
  let ipSum = 0;
  let count = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    const combos = combosOfHand(h).length;
    oopSum += oop[h]! * combos;
    ipSum += ip[h]! * combos;
    count += combos;
  }
  const mean = (oopSum + ipSum) / count;
  if (mean <= 0) return { oop, ip };

  const scale = 2 / mean;
  const scaledOop = new Float32Array(NUM_HANDS);
  const scaledIp = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    scaledOop[h] = oop[h]! * scale;
    scaledIp[h] = ip[h]! * scale;
  }
  return { oop: scaledOop, ip: scaledIp };
}

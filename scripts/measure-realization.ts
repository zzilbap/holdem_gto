/**
 * 에퀴티 실현율 측정.
 *
 *   npx vite-node --config vitest.config.ts scripts/measure-realization.ts
 *
 * 프리플롭 솔버가 쓰던 추측 공식을 실제 측정값으로 바꾸기 위한 스크립트다.
 * 대표 플롭을 무작위로 뽑아 하나하나 실제로 풀고, 각 핸드가 원래 에퀴티 대비
 * 얼마나 챙겼는지를 잰다.
 *
 * 닭과 달걀 문제가 있다 — R을 알아야 프리플롭을 풀고, 프리플롭 레인지가 있어야
 * R을 잰다. 그래서 **반복해서 수렴시킨다**:
 *
 *   1회차: 추측 공식으로 레인지를 얻어 → R 측정
 *   2회차: 그 R로 다시 풀어 레인지를 갱신 → R 재측정
 *   ...
 *
 * 레인지가 바뀌면 실현율도 바뀌므로(넓은 레인지를 상대할수록 잘 실현한다)
 * 한 번으로 끝나지 않는다. 이미 측정 파일이 있으면 그걸 출발점으로 삼는다.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NUM_CARDS, NUM_HANDS, handIndexToString, handRangeToCombos } from '@holdem/poker-core';
import {
  DEFAULT_6MAX_100BB,
  DEFAULT_FLOP_CONFIG,
  MEASURED_REALIZATION,
  MeasuredRealization,
  aggregateRealization,
  buildPreflopEquityTable,
  measureRealizationOnBoard,
  normalizePair,
  rangePercentOf,
  solvePreflop,
  spotKey,
  type RealizationSample,
} from '@holdem/solver';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../packages/solver/src/preflop/realization-data.generated.ts');

const BOARDS = 60;
const FLOP_ITERATIONS = 250;
const SEED = 424242;

function main() {
  const startedAt = Date.now();

  process.stdout.write('1) 지금 가진 실현율로 프리플롭을 한 번 풀어 레인지를 얻는다\n');
  const equityTable = buildPreflopEquityTable({ boardSamples: 8000, seed: SEED });
  const preflop = solvePreflop({
    config: DEFAULT_6MAX_100BB,
    equityTable,
    realization: new MeasuredRealization(MEASURED_REALIZATION),
    rounds: 4,
    iterationsPerSpot: 300,
  });

  /**
   * 측정 스팟: BTN이 오픈하고 BB가 콜한 싱글레이즈 팟.
   * 가장 흔하고, 두 레인지의 성격 차이(넓은 BB vs 좁은 BTN)가 뚜렷해서
   * 실현율 차이가 잘 드러난다.
   */
  const spot = preflop.spots.get(spotKey('BTN', 'BB'));
  if (!spot) throw new Error('BTN vs BB 스팟이 없습니다');

  const root = spot.tree.nodes[spot.tree.root]!;
  if (root.kind !== 'action') throw new Error('루트가 액션 노드가 아님');
  const callIndex = root.actions.findIndex((a) => a.kind === 'call');
  if (callIndex < 0) throw new Error('콜 액션이 없습니다');

  // BB(아웃오브포지션)는 콜한 부분만, BTN(인포지션)은 오픈 레인지 전체가 상대다.
  const bbCall = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    bbCall[h] = spot.result.strategy[root.offset + callIndex * NUM_HANDS + h]!;
  }
  const btnOpen = preflop.openFrequency.BTN;

  const oopWidth = rangePercentOf(bbCall) / 100;
  const ipWidth = rangePercentOf(btnOpen) / 100;
  process.stdout.write(
    `   BB 콜 레인지 ${(oopWidth * 100).toFixed(1)}% · BTN 오픈 레인지 ${(ipWidth * 100).toFixed(1)}%\n\n`,
  );

  const oopRange = handRangeToCombos(bbCall);
  const ipRange = handRangeToCombos(btnOpen);

  // BTN 2.5bb 오픈에 BB가 콜 → 팟 5.5bb, 남은 스택 97.5bb
  const pot = DEFAULT_6MAX_100BB.openSize.BTN * 2 + DEFAULT_6MAX_100BB.smallBlind;
  const effectiveStack = DEFAULT_6MAX_100BB.stack - DEFAULT_6MAX_100BB.openSize.BTN;
  const spr = effectiveStack / pot;

  process.stdout.write(`2) 플롭 ${BOARDS}개를 실제로 풀어 실현율을 잰다 (팟 ${pot}bb, SPR ${spr.toFixed(1)})\n`);

  const rng = mulberry32(SEED);
  const oopSamples: RealizationSample[] = [];
  const ipSamples: RealizationSample[] = [];

  for (let b = 0; b < BOARDS; b++) {
    const board = randomFlop(rng);
    const measurement = measureRealizationOnBoard({
      board,
      oopRange,
      ipRange,
      config: { ...DEFAULT_FLOP_CONFIG, pot, effectiveStack },
      iterations: FLOP_ITERATIONS,
    });
    oopSamples.push(...measurement.oop);
    ipSamples.push(...measurement.ip);

    if ((b + 1) % 10 === 0) {
      const elapsed = (Date.now() - startedAt) / 1000;
      process.stdout.write(`   ${b + 1}/${BOARDS} (${elapsed.toFixed(0)}초)\n`);
    }
  }

  const raw = normalizePair(aggregateRealization(oopSamples), aggregateRealization(ipSamples));

  const data = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    boards: BOARDS,
    oop: Array.from(raw.oop, (v) => round(v, 4)),
    ip: Array.from(raw.ip, (v) => round(v, 4)),
    context: {
      spr: round(spr, 2),
      oopVillainWidth: round(ipWidth, 4),
      ipVillainWidth: round(oopWidth, 4),
    },
  };

  writeFileSync(OUT_PATH, renderModule(data), 'utf8');

  process.stdout.write(`\n완료 — ${((Date.now() - startedAt) / 1000).toFixed(0)}초\n`);
  process.stdout.write(`  ${OUT_PATH}\n\n`);
  report(raw.oop, raw.ip);
}

function report(oop: Float32Array, ip: Float32Array) {
  process.stdout.write('측정된 실현율 (1보다 작으면 에퀴티만큼도 못 챙긴다는 뜻)\n');
  const show = ['AA', 'KK', '77', '22', 'AKs', 'AKo', 'T9s', 'T9o', 'A5s', '72o'];
  for (const hand of show) {
    const h = handIndexToStringReverse(hand);
    process.stdout.write(
      `  ${hand.padEnd(4)} OOP ${oop[h]!.toFixed(3)}  IP ${ip[h]!.toFixed(3)}\n`,
    );
  }

  const mean = (values: Float32Array) => {
    let sum = 0;
    for (let h = 0; h < NUM_HANDS; h++) sum += values[h]!;
    return sum / NUM_HANDS;
  };
  process.stdout.write(
    `\n  전체 평균 — OOP ${mean(oop).toFixed(3)} · IP ${mean(ip).toFixed(3)}\n`,
  );
}

function handIndexToStringReverse(text: string): number {
  for (let h = 0; h < NUM_HANDS; h++) if (handIndexToString(h) === text) return h;
  throw new Error(`핸드를 찾을 수 없습니다: ${text}`);
}

function randomFlop(rng: () => number): number[] {
  const used = new Set<number>();
  while (used.size < 3) used.add((rng() * NUM_CARDS) | 0);
  return [...used];
}

function renderModule(data: ReturnType<typeof buildData>): string {
  return `// 이 파일은 scripts/measure-realization.ts가 생성합니다. 직접 고치지 마세요.
import type { RealizationData } from './measured-realization';

export const MEASURED_REALIZATION: RealizationData = ${JSON.stringify(data, null, 2)};
`;
}

// 타입 추론용 더미 (renderModule의 시그니처를 위해)
function buildData() {
  return {} as {
    version: 1;
    generatedAt: string;
    boards: number;
    oop: number[];
    ip: number[];
    context: { spr: number; oopVillainWidth: number; ipVillainWidth: number };
  };
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main();

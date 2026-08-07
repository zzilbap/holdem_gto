/**
 * 프리솔브 데이터 생성.
 *
 *   npm run data --workspace=@holdem/web
 *
 * 브라우저에서 매번 17초를 기다리게 할 수는 없으므로, 기본 설정(6맥스 100bb)은
 * 여기서 미리 풀어 정적 파일로 굽는다. 사용자가 스택이나 사이즈를 바꾸면
 * 그때만 브라우저 Worker가 다시 푼다.
 *
 * 트리는 설정에서 결정적으로 만들어지므로 저장하지 않는다. 클라이언트가
 * buildSpotTree로 다시 만들고 여기서 저장한 전략 배열만 얹으면 된다.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NUM_HANDS } from '@holdem/poker-core';
import {
  DEFAULT_6MAX_100BB,
  HeuristicRealization,
  POSITIONS_6MAX,
  buildPreflopEquityTable,
  enumerateSpotPairs,
  packEquityTable,
  rangePercentOf,
  solvePreflop,
  spotKey,
  type Position,
} from '@holdem/solver';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, '../apps/web/public/data/preflop-6max-100bb.json');

// 보드 수가 곧 에퀴티 표의 유효 표본 수다. 빌드 타임이니 넉넉하게 쓴다.
const BOARD_SAMPLES = 30000;
const ROUNDS = 6;
const ITERATIONS_PER_SPOT = 600;

function main() {
  const startedAt = Date.now();

  process.stdout.write(`에퀴티 표 생성 (보드 ${BOARD_SAMPLES.toLocaleString()}개)...\n`);
  const equityTable = buildPreflopEquityTable({
    boardSamples: BOARD_SAMPLES,
    seed: 20260807,
    onProgress: (done, total) => {
      if (done % 5000 === 0) {
        process.stdout.write(`  ${((done / total) * 100).toFixed(0)}%\n`);
      }
    },
  });

  process.stdout.write(`\n프리플롭 솔브 (${ROUNDS}라운드 × 스팟당 ${ITERATIONS_PER_SPOT}회)...\n`);
  let lastLabel = '';
  const solution = solvePreflop({
    config: DEFAULT_6MAX_100BB,
    equityTable,
    realization: new HeuristicRealization(),
    rounds: ROUNDS,
    iterationsPerSpot: ITERATIONS_PER_SPOT,
    onProgress: (done, total, label) => {
      if (label !== lastLabel) {
        lastLabel = label;
        process.stdout.write(`  [${done}/${total}] ${label}\n`);
      }
    },
  });

  const payload = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    config: solution.config,
    boardSamples: BOARD_SAMPLES,
    rounds: ROUNDS,
    iterationsPerSpot: ITERATIONS_PER_SPOT,
    lastRoundDrift: round(solution.lastRoundDrift, 6),
    equityTable: packEquityTable(equityTable),
    openFrequency: mapPositions((p) => packUnit(solution.openFrequency[p])),
    openEdge: mapPositions((p) => Array.from(solution.openEdge[p], (v) => round(v, 4))),
    spots: Object.fromEntries(
      enumerateSpotPairs().map(({ opener, responder }) => {
        const key = spotKey(opener, responder);
        const spot = solution.spots.get(key);
        if (!spot) throw new Error(`스팟이 없습니다: ${key}`);
        return [
          key,
          {
            opener,
            responder,
            strategy: packUnit(spot.result.strategy),
            responderFold: packUnit(spot.responderFoldProbability),
            residualRegret: round(spot.result.residualRegret, 6),
          },
        ];
      }),
    ),
  };

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(payload);
  writeFileSync(OUT_PATH, json, 'utf8');

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`\n완료 — ${seconds}초, ${(json.length / 1024).toFixed(0)}KB\n`);
  process.stdout.write(`  ${OUT_PATH}\n\n`);
  process.stdout.write('RFI 레인지\n');
  for (const position of POSITIONS_6MAX) {
    if (position === 'BB') continue;
    const pct = rangePercentOf(solution.openFrequency[position]);
    process.stdout.write(`  ${position.padEnd(4)} ${pct.toFixed(1)}%\n`);
  }
  process.stdout.write(`\n수렴 지표 (마지막 라운드 변동량) ${solution.lastRoundDrift.toFixed(6)}\n`);
}

/** 0~1 값 배열을 Uint8로 양자화해 base64로. 오차 0.2%면 화면 표시에 충분하다. */
function packUnit(values: Float32Array): string {
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    bytes[i] = Math.round(Math.min(1, Math.max(0, values[i]!)) * 255);
  }
  return Buffer.from(bytes).toString('base64');
}

function mapPositions<T>(fn: (position: Position) => T): Record<Position, T> {
  const out = {} as Record<Position, T>;
  for (const position of POSITIONS_6MAX) out[position] = fn(position);
  return out;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// 169칸이 맞는지 최소한의 확인 — 표 형식이 바뀌면 여기서 먼저 터진다.
if (NUM_HANDS !== 169) throw new Error(`핸드 수가 169가 아닙니다: ${NUM_HANDS}`);

main();

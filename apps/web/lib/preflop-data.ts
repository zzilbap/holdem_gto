import { NUM_HANDS } from '@holdem/poker-core';
import {
  buildSpotTree,
  makeSpotDefinition,
  spotKey,
  unpackEquityTable,
  type PreflopConfig,
  type Position,
  type SpotTree,
} from '@holdem/solver';

/**
 * 프리솔브 데이터 로더.
 *
 * 트리는 파일에 없다. 설정에서 결정적으로 만들어지므로 여기서 다시 짓고,
 * 파일에 담긴 전략 배열만 얹는다. 덕분에 파일이 157KB로 끝난다.
 */

export interface PreflopDataFile {
  version: 1;
  generatedAt: string;
  config: PreflopConfig;
  boardSamples: number;
  rounds: number;
  iterationsPerSpot: number;
  lastRoundDrift: number;
  equityTable: string;
  openFrequency: Record<Position, string>;
  openEdge: Record<Position, number[]>;
  spots: Record<
    string,
    {
      opener: Position;
      responder: Position;
      strategy: string;
      responderFold: string;
      residualRegret: number;
    }
  >;
}

export interface LoadedSpot {
  opener: Position;
  responder: Position;
  tree: SpotTree;
  strategy: Float32Array;
  responderFold: Float32Array;
}

export interface PreflopData {
  config: PreflopConfig;
  generatedAt: string;
  openFrequency: Record<Position, Float32Array>;
  openEdge: Record<Position, Float32Array>;
  spots: Map<string, LoadedSpot>;
  equityTable: Float32Array;
  meta: { boardSamples: number; rounds: number; iterationsPerSpot: number; drift: number };
}

let cached: Promise<PreflopData> | null = null;

/** 한 번만 받아서 계속 쓴다. 페이지를 오가도 다시 내려받지 않는다. */
export function loadPreflopData(): Promise<PreflopData> {
  if (!cached) cached = fetchAndParse();
  return cached;
}

async function fetchAndParse(): Promise<PreflopData> {
  const response = await fetch(`${basePath()}/data/preflop-6max-100bb.json`);
  if (!response.ok) {
    throw new Error(`프리솔브 데이터를 불러오지 못했습니다 (${response.status})`);
  }
  const file = (await response.json()) as PreflopDataFile;
  return parsePreflopData(file);
}

export function parsePreflopData(file: PreflopDataFile): PreflopData {
  const config = file.config;
  const spots = new Map<string, LoadedSpot>();

  for (const [key, raw] of Object.entries(file.spots)) {
    const definition = makeSpotDefinition(raw.opener, raw.responder, config);
    const tree = buildSpotTree(definition, config);
    const strategy = unpackUnit(raw.strategy);

    if (strategy.length !== tree.strategySize) {
      // 설정이 바뀌었는데 데이터를 다시 굽지 않으면 여기서 걸린다.
      throw new Error(
        `${key}: 전략 크기가 트리와 맞지 않습니다 (${strategy.length} vs ${tree.strategySize}). ` +
          `npm run data 로 다시 생성하세요.`,
      );
    }

    spots.set(key, {
      opener: raw.opener,
      responder: raw.responder,
      tree,
      strategy,
      responderFold: unpackUnit(raw.responderFold),
    });
  }

  return {
    config,
    generatedAt: file.generatedAt,
    openFrequency: mapValues(file.openFrequency, unpackUnit),
    openEdge: mapValues(file.openEdge, (values) => Float32Array.from(values)),
    spots,
    equityTable: unpackEquityTable(file.equityTable),
    meta: {
      boardSamples: file.boardSamples,
      rounds: file.rounds,
      iterationsPerSpot: file.iterationsPerSpot,
      drift: file.lastRoundDrift,
    },
  };
}

/**
 * 워커가 새 설정으로 다시 푼 결과를 화면이 쓰는 형태로 바꾼다.
 *
 * 설정이 바뀌면 액션 트리 자체가 달라지므로(사이즈가 바뀌면 노드 수도 바뀐다)
 * 트리를 새로 짓고 전략을 얹는다. 에퀴티 표는 카드만의 성질이라 그대로 쓴다.
 */
export function applySolveOutcome(
  base: PreflopData,
  config: PreflopConfig,
  outcome: {
    openFrequency: Record<string, Float32Array>;
    openEdge: Record<string, Float32Array>;
    spots: Record<string, { strategy: Float32Array; responderFold: Float32Array }>;
    lastRoundDrift: number;
  },
): PreflopData {
  const spots = new Map<string, LoadedSpot>();

  for (const [key, raw] of Object.entries(outcome.spots)) {
    const [opener, responder] = key.split('>') as [Position, Position];
    const tree = buildSpotTree(makeSpotDefinition(opener, responder, config), config);
    if (raw.strategy.length !== tree.strategySize) {
      throw new Error(
        `${key}: 전략 크기가 트리와 맞지 않습니다 (${raw.strategy.length} vs ${tree.strategySize}).`,
      );
    }
    spots.set(key, {
      opener,
      responder,
      tree,
      strategy: raw.strategy,
      responderFold: raw.responderFold,
    });
  }

  return {
    ...base,
    config,
    spots,
    openFrequency: outcome.openFrequency as Record<Position, Float32Array>,
    openEdge: outcome.openEdge as Record<Position, Float32Array>,
    meta: { ...base.meta, drift: outcome.lastRoundDrift },
  };
}

export function getSpot(data: PreflopData, opener: Position, responder: Position): LoadedSpot {
  const spot = data.spots.get(spotKey(opener, responder));
  if (!spot) throw new Error(`스팟을 찾을 수 없습니다: ${opener} vs ${responder}`);
  return spot;
}

function unpackUnit(encoded: string): Float32Array {
  const binary = atob(encoded);
  const out = new Float32Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) / 255;
  return out;
}

function mapValues<A, B>(source: Record<Position, A>, fn: (value: A) => B): Record<Position, B> {
  const out = {} as Record<Position, B>;
  for (const key of Object.keys(source) as Position[]) out[key] = fn(source[key]);
  return out;
}

/** GitHub Pages 같은 서브경로 배포를 대비한 자리. 지금은 루트 배포라 빈 문자열. */
function basePath(): string {
  return '';
}

export { NUM_HANDS };

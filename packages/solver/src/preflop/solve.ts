import { NUM_HANDS, combosOfHand } from '@holdem/poker-core';
import { solveSpot, type SolveResult } from './cfr';
import { POSITIONS_6MAX, type PreflopConfig, type Position } from './config';
import { collisionMatrix } from './equity-table';
import type { RealizationModel } from './realization';
import { buildSpotTree, type SpotDefinition, type SpotTree } from './spot';

/**
 * 프리플롭 전체를 푸는 오케스트레이터.
 *
 * 6인 트리를 통째로 풀지 않고 (opener, responder) 2인 스팟 15개로 쪼갠다.
 * 스팟 하나의 트리에 오픈 → 3벳 → 4벳 → 5벳이 전부 들어 있으므로,
 * 스팟 하나를 풀면 "BB가 3벳할 패", "UTG가 4벳할 패", "BB가 5벳할 패"가 한 번에 나온다.
 *
 * 문제는 스팟들이 서로의 답에 의존한다는 것이다. BTN이 어디까지 오픈할지는
 * BB가 얼마나 3벳하는지에 달렸고, BB의 3벳 범위는 BTN의 오픈 범위에 달렸다.
 * 그래서 대충 찍고 시작해서 번갈아 고쳐나간다 (fictitious play).
 * 값이 더 이상 움직이지 않는 지점이 균형이다.
 */

/** RFI를 할 수 있는 자리. BB는 이미 돈을 냈으므로 '오픈'이라는 개념이 없다. */
export const OPENING_POSITIONS: readonly Position[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];

export interface PreflopSolveOptions {
  config: PreflopConfig;
  equityTable: Float32Array;
  realization: RealizationModel;
  /** 레인지를 서로 맞춰가는 왕복 횟수. 보통 4~6회면 값이 멈춘다. */
  rounds: number;
  /** 스팟 하나당 CFR 반복 횟수. */
  iterationsPerSpot: number;
  onProgress?: (done: number, total: number, label: string) => void;
  shouldStop?: () => boolean;
}

export interface SolvedSpot {
  key: string;
  opener: Position;
  responder: Position;
  tree: SpotTree;
  result: SolveResult;
  /** 이 스팟에서 opener가 오픈했을 때 responder가 폴드할 확률 (opener 핸드에 조건부). */
  responderFoldProbability: Float32Array;
  /** responder가 폴드하지 않았을 때 opener의 조건부 EV. */
  openerEvIfContested: Float32Array;
}

export interface SolvedSqueeze {
  key: string;
  opener: Position;
  threeBettor: Position;
  squeezer: Position;
  tree: SpotTree;
  result: SolveResult;
  /** 3벳한 사람이 이 스팟에 들고 들어온 레인지. */
  threeBetRange: Float32Array;
}

export interface PreflopSolution {
  config: PreflopConfig;
  /** 포지션별 오픈 빈도(169칸). 이게 곧 RFI 차트다. */
  openFrequency: Record<Position, Float32Array>;
  /** 오픈 EV에서 폴드 EV를 뺀 값. 0보다 크면 오픈이 이득이다. */
  openEdge: Record<Position, Float32Array>;
  spots: Map<string, SolvedSpot>;
  /**
   * 스퀴즈 스팟 — 누가 열고 다른 사람이 3벳한 뒤 세 번째 사람이 결정하는 자리.
   *
   * 기본 스팟이 다 수렴한 뒤 한 번만 푼다. 3벳 레인지가 확정되어야
   * 그걸 상대로 스퀴저의 답을 낼 수 있기 때문이다.
   */
  squeezes: Map<string, SolvedSqueeze>;
  rounds: number;
  /** 마지막 라운드에서 오픈 빈도가 얼마나 움직였는지. 0에 가까우면 수렴했다. */
  lastRoundDrift: number;
}

export function spotKey(opener: Position, responder: Position): string {
  return `${opener}>${responder}`;
}

/**
 * 스퀴즈 스팟의 키. "누가 열고, 누가 3벳했고, 누가 그 위에서 결정하는가".
 *
 * 예: `CO^BTN>BB` = CO가 열고 BTN이 3벳했는데 BB 차례.
 */
export function squeezeKey(
  opener: Position,
  threeBettor: Position,
  squeezer: Position,
): string {
  return `${opener}^${threeBettor}>${squeezer}`;
}

/**
 * 스퀴즈 상황을 2인 스팟으로 세운다.
 *
 * "CO 오픈 → BTN 3벳 → BB 차례"에서 BB가 상대할 사람은 사실상 BTN이다.
 * CO는 3벳까지 맞았으니 대부분 접고, 그 2.5bb는 팟에 남는 죽은 돈이 된다.
 *
 * **근사임을 분명히 해둔다** — CO가 4벳으로 되받는 경우를 세지 않는다.
 * 실제 해법에서 그 빈도는 낮지만 0은 아니다. 이걸 정확히 하려면 3인 프리플롭
 * CFR이 필요하고, 그건 이 구조로는 못 한다.
 */
export function makeSqueezeDefinition(
  opener: Position,
  threeBettor: Position,
  squeezer: Position,
  threeBetTo: number,
  config: PreflopConfig,
): SpotDefinition {
  const openTo = config.openSize[opener];

  // 죽은 돈 = 오픈한 사람이 두고 갈 돈 + 이 셋에 끼지 않은 블라인드
  let deadMoney = openTo;
  const involved = new Set<Position>([opener, threeBettor, squeezer]);
  if (!involved.has('SB')) deadMoney += config.smallBlind;
  if (!involved.has('BB')) deadMoney += config.bigBlind;

  return {
    first: squeezer,
    second: threeBettor,
    deadMoney,
    invested: [blindOf(squeezer, config), threeBetTo],
    raiseCount: 2,
    label: `${opener} ${fmtBb(openTo)}bb 오픈, ${threeBettor} ${fmtBb(threeBetTo)}bb 3벳, ${squeezer} 차례`,
  };
}

/** 스퀴즈가 성립하는 (오픈, 3벳, 결정할 사람) 조합. 셋 다 자리 순서를 지켜야 한다. */
export function enumerateSqueezeTriples(): Array<{
  opener: Position;
  threeBettor: Position;
  squeezer: Position;
}> {
  const out: Array<{ opener: Position; threeBettor: Position; squeezer: Position }> = [];
  for (const opener of OPENING_POSITIONS) {
    const openerIndex = POSITIONS_6MAX.indexOf(opener);
    for (let t = openerIndex + 1; t < POSITIONS_6MAX.length; t++) {
      for (let s = t + 1; s < POSITIONS_6MAX.length; s++) {
        out.push({
          opener,
          threeBettor: POSITIONS_6MAX[t]!,
          squeezer: POSITIONS_6MAX[s]!,
        });
      }
    }
  }
  return out;
}

function fmtBb(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function solvePreflop(options: PreflopSolveOptions): PreflopSolution {
  const { config, equityTable, realization, rounds, iterationsPerSpot } = options;
  const pairs = enumerateSpotPairs();
  const totalWork = rounds * pairs.length + enumerateSqueezeTriples().length;
  let done = 0;

  const openFrequency = initialOpenRanges(equityTable);
  const openEdge = emptyByPosition();
  const spots = new Map<string, SolvedSpot>();
  let lastRoundDrift = Number.POSITIVE_INFINITY;

  /**
   * 각 스팟에서 responder가 폴드하지 않고 따라오는 레인지의 폭.
   *
   * 오프너의 실현율을 계산할 때 필요하다. 첫 라운드엔 알 수 없으므로 흔한 값으로
   * 시작하고, 라운드가 돌면서 실제 값으로 대체된다. 레인지가 서로 맞춰지듯
   * 이 값도 같이 수렴한다.
   */
  const continuationWidth = new Map<string, number>();
  const DEFAULT_CONTINUATION = 0.36;

  for (let round = 0; round < rounds; round++) {
    if (options.shouldStop?.()) break;
    const previous = snapshot(openFrequency);

    for (const { opener, responder } of pairs) {
      if (options.shouldStop?.()) break;

      const definition = makeSpotDefinition(opener, responder, config);
      const tree = buildSpotTree(definition, config);

      // responder는 아직 아무 행동도 안 했으니 전 레인지에서 출발한다.
      // opener는 지금까지 수렴한 오픈 레인지를 들고 들어온다.
      const responderRange = new Float32Array(NUM_HANDS).fill(1);
      const openerRange = normalizedOpenRange(openFrequency[opener]);

      const key = spotKey(opener, responder);
      const result = solveSpot(tree, {
        iterations: iterationsPerSpot,
        ranges: [responderRange, openerRange],
        equityTable,
        realization,
        shouldStop: options.shouldStop,
        // responder가 상대할 건 오프너의 오픈 레인지,
        // 오프너가 상대할 건 responder 중 따라온 부분이다.
        villainWidths: [
          rangePercentOf(openFrequency[opener]) / 100,
          continuationWidth.get(key) ?? DEFAULT_CONTINUATION,
        ],
      });

      const solved = buildSolvedSpot(opener, responder, tree, result);
      spots.set(key, solved);
      continuationWidth.set(key, measureContinuation(solved));
      done++;
      options.onProgress?.(done, totalWork, `${opener} vs ${responder}`);
    }

    updateOpenRanges(openFrequency, openEdge, spots, config);
    lastRoundDrift = drift(previous, openFrequency);
  }

  // 3벳 레인지가 확정된 뒤에 스퀴즈를 푼다. 순서가 반대면 상대할 레인지가 없다.
  const squeezes = solveSqueezeSpots();

  return { config, openFrequency, openEdge, spots, squeezes, rounds, lastRoundDrift };

  function solveSqueezeSpots(): Map<string, SolvedSqueeze> {
    const out = new Map<string, SolvedSqueeze>();
    if (options.shouldStop?.()) return out;

    for (const { opener, threeBettor, squeezer } of enumerateSqueezeTriples()) {
      if (options.shouldStop?.()) break;

      const base = spots.get(spotKey(opener, threeBettor));
      if (!base) continue;

      const root = base.tree.nodes[base.tree.root]!;
      if (root.kind !== 'action') continue;
      const raiseIndex = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
      if (raiseIndex < 0) continue;

      const threeBetTo = root.actions[raiseIndex]!.to;

      // 3벳한 사람이 들고 오는 레인지 = 그 액션의 빈도.
      const threeBetRange = new Float32Array(NUM_HANDS);
      let mass = 0;
      for (let h = 0; h < NUM_HANDS; h++) {
        threeBetRange[h] = base.result.strategy[root.offset + raiseIndex * NUM_HANDS + h]!;
        mass += threeBetRange[h]! * combosOfHand(h).length;
      }
      // 3벳을 아예 안 하는 조합이면 스팟 자체가 성립하지 않는다.
      if (mass < 1) continue;

      const definition = makeSqueezeDefinition(opener, threeBettor, squeezer, threeBetTo, config);
      const tree = buildSpotTree(definition, config);

      const result = solveSpot(tree, {
        iterations: iterationsPerSpot,
        // 스퀴저는 아직 아무것도 안 했으니 전 레인지에서 출발한다.
        ranges: [new Float32Array(NUM_HANDS).fill(1), threeBetRange],
        equityTable,
        realization,
        shouldStop: options.shouldStop,
        villainWidths: [mass / 1326, DEFAULT_CONTINUATION],
      });

      const key = squeezeKey(opener, threeBettor, squeezer);
      out.set(key, { key, opener, threeBettor, squeezer, tree, result, threeBetRange });
      done++;
      options.onProgress?.(done, totalWork, `스퀴즈 ${opener}^${threeBettor}>${squeezer}`);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 스팟 구성
// ---------------------------------------------------------------------------

interface SpotPair {
  opener: Position;
  responder: Position;
}

/**
 * (오픈한 사람, 반응하는 사람) 쌍. responder는 반드시 opener보다 뒤에 앉는다.
 * 6맥스면 5 + 4 + 3 + 2 + 1 = 15개다.
 */
export function enumerateSpotPairs(): SpotPair[] {
  const out: SpotPair[] = [];
  for (const opener of OPENING_POSITIONS) {
    const openerIndex = POSITIONS_6MAX.indexOf(opener);
    for (let i = openerIndex + 1; i < POSITIONS_6MAX.length; i++) {
      out.push({ opener, responder: POSITIONS_6MAX[i]! });
    }
  }
  return out;
}

/** 블라인드를 낸 자리인지 (스팟에 들어올 때 이미 투자한 금액). */
function blindOf(position: Position, config: PreflopConfig): number {
  if (position === 'SB') return config.smallBlind;
  if (position === 'BB') return config.bigBlind;
  return 0;
}

export function makeSpotDefinition(
  opener: Position,
  responder: Position,
  config: PreflopConfig,
): SpotDefinition {
  const openTo = config.openSize[opener];

  // opener도 responder도 아닌 사람이 낸 돈은 그냥 팟에 놓인 죽은 돈이다.
  // responder가 SB면 뒤에 BB가 남아 있지만, 2인으로 자르는 이상 BB의 1bb는
  // 데드머니로 처리한다. 스퀴즈 가능성을 무시하는 근사다.
  let deadMoney = 0;
  if (opener !== 'SB' && responder !== 'SB') deadMoney += config.smallBlind;
  if (opener !== 'BB' && responder !== 'BB') deadMoney += config.bigBlind;

  return {
    // 오픈은 이미 끝났으므로 responder가 먼저 행동한다.
    first: responder,
    second: opener,
    deadMoney,
    invested: [blindOf(responder, config), openTo],
    raiseCount: 1,
    label: `${opener}가 ${openTo}bb 오픈, ${responder} 차례`,
  };
}

function buildSolvedSpot(
  opener: Position,
  responder: Position,
  tree: SpotTree,
  result: SolveResult,
): SolvedSpot {
  const root = tree.nodes[tree.root]!;
  const foldProbability = new Float32Array(NUM_HANDS);
  const contestedEv = new Float32Array(NUM_HANDS);

  if (root.kind === 'action' && result.rootBreakdown) {
    const { probability, opponentEv } = result.rootBreakdown;
    const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');

    for (let h = 0; h < NUM_HANDS; h++) {
      const pFold = foldIndex >= 0 ? probability[foldIndex]![h]! : 0;
      foldProbability[h] = pFold;

      // 폴드가 아닌 액션들의 확률 가중 평균 = "붙었을 때" opener의 EV
      let weighted = 0;
      let mass = 0;
      for (let a = 0; a < probability.length; a++) {
        if (a === foldIndex) continue;
        const p = probability[a]![h]!;
        weighted += p * opponentEv[a]![h]!;
        mass += p;
      }
      contestedEv[h] = mass > 1e-9 ? weighted / mass : 0;
    }
  }

  return {
    key: spotKey(opener, responder),
    opener,
    responder,
    tree,
    result,
    responderFoldProbability: foldProbability,
    openerEvIfContested: contestedEv,
  };
}

/**
 * responder가 폴드하지 않고 따라오는 레인지가 전체의 몇 %인가.
 *
 * 오프너가 플롭에서 실제로 마주할 레인지의 폭이고, 오프너의 실현율 계산에 들어간다.
 */
function measureContinuation(spot: SolvedSpot): number {
  const root = spot.tree.nodes[spot.tree.root]!;
  if (root.kind !== 'action') return 0.36;

  const foldIndex = root.actions.findIndex((a) => a.kind === 'fold');
  if (foldIndex < 0) return 1;

  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    const foldFreq = spot.result.strategy[root.offset + foldIndex * NUM_HANDS + h]!;
    combos += (1 - foldFreq) * combosOfHand(h).length;
  }
  return combos / 1326;
}

// ---------------------------------------------------------------------------
// RFI 갱신
// ---------------------------------------------------------------------------

/**
 * 오픈의 가치를 계산한다.
 *
 * 뒤에 앉은 사람들이 차례로 반응하는데, 앞사람이 폴드해야 뒷사람 차례가 온다.
 * 그래서 "여기까지 전부 폴드했을 확률"을 곱해가며 훑는다.
 *
 *   EV = Σ_j (j 앞이 전부 폴드할 확률) × (j가 붙었을 때의 EV)
 *      + (전원 폴드할 확률) × 블라인드
 *
 * 콜드콜이 두 명 이상 들어오는 경우는 세지 않는다. ARCHITECTURE.md에 적어둔 근사다.
 */
function updateOpenRanges(
  openFrequency: Record<Position, Float32Array>,
  openEdge: Record<Position, Float32Array>,
  spots: Map<string, SolvedSpot>,
  config: PreflopConfig,
): void {
  const blinds = config.smallBlind + config.bigBlind;

  for (const opener of OPENING_POSITIONS) {
    const openerIndex = POSITIONS_6MAX.indexOf(opener);
    const responders = POSITIONS_6MAX.slice(openerIndex + 1);
    const foldEv = -blindOf(opener, config);
    const winsUncontested = blinds - blindOf(opener, config);

    const edge = openEdge[opener];
    const freq = openFrequency[opener];

    for (let h = 0; h < NUM_HANDS; h++) {
      let ev = 0;
      let reachedHere = 1; // 여기까지 전부 폴드했을 확률

      for (const responder of responders) {
        const spot = spots.get(spotKey(opener, responder));
        if (!spot) continue;
        const pFold = spot.responderFoldProbability[h]!;
        ev += reachedHere * (1 - pFold) * spot.openerEvIfContested[h]!;
        reachedHere *= pFold;
      }

      ev += reachedHere * winsUncontested;
      edge[h] = ev - foldEv;
      freq[h] = mixFrequency(edge[h]!);
    }
  }
}

/**
 * EV 차이를 오픈 빈도로 바꾼다.
 *
 * 딱 잘라 0/1로 만들면 경계에 있는 패들이 라운드마다 튀어서 수렴이 흔들린다.
 * 실제 해법에서도 경계 근처 패는 섞어 치므로, 좁은 구간에서 선형으로 이어준다.
 */
function mixFrequency(edge: number): number {
  const band = 0.08; // bb
  if (edge <= -band) return 0;
  if (edge >= band) return 1;
  return (edge + band) / (2 * band);
}

// ---------------------------------------------------------------------------
// 초기 레인지
// ---------------------------------------------------------------------------

/**
 * 아무 데서나 시작해도 수렴하지만, 그럴싸한 값에서 출발하면 훨씬 빨리 멈춘다.
 * 핸드를 "무작위 상대 대비 에퀴티" 순으로 세우고 포지션별로 위에서부터 자른다.
 */
function initialOpenRanges(equityTable: Float32Array): Record<Position, Float32Array> {
  const strength = handStrengthOrder(equityTable);
  const targets: Record<Position, number> = {
    UTG: 0.16,
    HJ: 0.2,
    CO: 0.27,
    BTN: 0.44,
    SB: 0.45,
    BB: 0,
  };

  const out = emptyByPosition();
  for (const position of POSITIONS_6MAX) {
    out[position] = topFraction(strength, targets[position]);
  }
  return out;
}

/** 169칸을 강한 순으로 나열한 인덱스 배열. */
function handStrengthOrder(equityTable: Float32Array): number[] {
  const collision = collisionMatrix();
  const score = new Float32Array(NUM_HANDS);

  for (let h = 0; h < NUM_HANDS; h++) {
    const row = h * NUM_HANDS;
    let weighted = 0;
    let mass = 0;
    for (let o = 0; o < NUM_HANDS; o++) {
      const w = collision[row + o]!;
      weighted += w * equityTable[row + o]!;
      mass += w;
    }
    score[h] = mass > 0 ? weighted / mass : 0;
  }

  return Array.from({ length: NUM_HANDS }, (_, i) => i).sort((a, b) => score[b]! - score[a]!);
}

/** 콤보 수 기준 상위 fraction만 1로 채운 레인지. */
function topFraction(order: readonly number[], fraction: number): Float32Array {
  const out = new Float32Array(NUM_HANDS);
  if (fraction <= 0) return out;
  const budget = fraction * 1326;
  let used = 0;
  for (const h of order) {
    if (used >= budget) break;
    const combos = combosOfHand(h).length;
    if (used + combos <= budget) {
      out[h] = 1;
      used += combos;
    } else {
      out[h] = (budget - used) / combos;
      used = budget;
    }
  }
  return out;
}

/**
 * 오픈 빈도를 CFR 입력용 레인지로 바꾼다.
 *
 * 오픈 빈도가 전부 0이면 (초기값이 이상하거나 수렴이 튀는 경우) CFR이 빈 레인지를
 * 받아 아무것도 못 하게 되므로 최소한의 바닥을 깔아준다.
 */
function normalizedOpenRange(frequency: Float32Array): Float32Array {
  const out = new Float32Array(NUM_HANDS);
  let sum = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    out[h] = frequency[h]!;
    sum += out[h]!;
  }
  if (sum < 1e-6) out.fill(0.05);
  return out;
}

// ---------------------------------------------------------------------------
// 잡동사니
// ---------------------------------------------------------------------------

function emptyByPosition(): Record<Position, Float32Array> {
  return {
    UTG: new Float32Array(NUM_HANDS),
    HJ: new Float32Array(NUM_HANDS),
    CO: new Float32Array(NUM_HANDS),
    BTN: new Float32Array(NUM_HANDS),
    SB: new Float32Array(NUM_HANDS),
    BB: new Float32Array(NUM_HANDS),
  };
}

function snapshot(source: Record<Position, Float32Array>): Record<Position, Float32Array> {
  const out = emptyByPosition();
  for (const position of POSITIONS_6MAX) out[position].set(source[position]);
  return out;
}

/** 두 레인지 집합이 얼마나 다른지. 라운드마다 이 값이 줄면 수렴 중이다. */
function drift(
  before: Record<Position, Float32Array>,
  after: Record<Position, Float32Array>,
): number {
  let total = 0;
  let count = 0;
  for (const position of POSITIONS_6MAX) {
    for (let h = 0; h < NUM_HANDS; h++) {
      total += Math.abs(after[position][h]! - before[position][h]!);
      count++;
    }
  }
  return count > 0 ? total / count : 0;
}

/** 레인지가 전체의 몇 %인지 (콤보 가중). 화면과 로그에 쓰는 값. */
export function rangePercentOf(frequency: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) combos += frequency[h]! * combosOfHand(h).length;
  return (combos / 1326) * 100;
}

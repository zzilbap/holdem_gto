import { NUM_CARDS, NUM_RANKS, RANKS, makeCard, rankOf, suitOf, type Card } from './cards';

/**
 * 레인지는 두 해상도로 다룬다.
 *
 *  - 169 핸드 그리드: 사람이 보는 단위. "AKs"는 한 칸.
 *  - 1326 콤보:      솔버가 보는 단위. "AsKs"와 "AhKh"는 블로커가 다르므로 별개.
 *
 * UI는 169로 말하고 엔진은 1326으로 계산한다. 둘 사이 변환이 이 파일의 일이다.
 */

export const NUM_HANDS = 169;
export const NUM_COMBOS = 1326;

/**
 * 그리드 좌표는 GTO 차트 관례를 따른다.
 *   row 0 / col 0 = A, row 12 / col 12 = 2
 *   row < col  → 수딧 (오른쪽 위)
 *   row > col  → 오프수트 (왼쪽 아래)
 *   row == col → 포켓 페어 (대각선)
 */
export function gridToHandIndex(row: number, col: number): number {
  return row * NUM_RANKS + col;
}

export function handIndexToGrid(handIndex: number): { row: number; col: number } {
  return { row: (handIndex / NUM_RANKS) | 0, col: handIndex % NUM_RANKS };
}

/** row/col(0=A) → 실제 랭크 값(12=A) */
function gridRank(gridPos: number): number {
  return NUM_RANKS - 1 - gridPos;
}

export type HandShape = 'pair' | 'suited' | 'offsuit';

export function handShape(handIndex: number): HandShape {
  const { row, col } = handIndexToGrid(handIndex);
  if (row === col) return 'pair';
  return row < col ? 'suited' : 'offsuit';
}

/** 0 → "AA", 1 → "AKs", 13 → "AKo" */
export function handIndexToString(handIndex: number): string {
  const { row, col } = handIndexToGrid(handIndex);
  const hi = RANKS[gridRank(Math.min(row, col))]!;
  const lo = RANKS[gridRank(Math.max(row, col))]!;
  if (row === col) return hi + hi;
  return hi + lo + (row < col ? 's' : 'o');
}

/** "AKs" → 1. 대소문자와 랭크 순서는 관대하게 받는다. */
export function handStringToIndex(text: string): number {
  const t = text.trim();
  if (t.length < 2 || t.length > 3) throw new Error(`핸드 표기가 올바르지 않습니다: "${text}"`);
  const r1 = RANKS.indexOf(t[0]!.toUpperCase());
  const r2 = RANKS.indexOf(t[1]!.toUpperCase());
  if (r1 < 0 || r2 < 0) throw new Error(`알 수 없는 랭크입니다: "${text}"`);

  const hi = Math.max(r1, r2);
  const lo = Math.min(r1, r2);
  const hiPos = NUM_RANKS - 1 - hi;
  const loPos = NUM_RANKS - 1 - lo;

  if (hi === lo) {
    if (t.length === 3) throw new Error(`포켓 페어에는 s/o를 붙이지 않습니다: "${text}"`);
    return gridToHandIndex(hiPos, hiPos);
  }
  if (t.length !== 3) throw new Error(`s 또는 o가 필요합니다: "${text}"`);
  const suffix = t[2]!.toLowerCase();
  if (suffix === 's') return gridToHandIndex(hiPos, loPos);
  if (suffix === 'o') return gridToHandIndex(loPos, hiPos);
  throw new Error(`s 또는 o여야 합니다: "${text}"`);
}

// ---------------------------------------------------------------------------
// 콤보
// ---------------------------------------------------------------------------

/** 두 카드(순서 무관)를 0..1325 콤보 인덱스로. */
export function comboIndex(a: Card, b: Card): number {
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return (hi * (hi - 1)) / 2 + lo;
}

const COMBO_CARD_A = new Uint8Array(NUM_COMBOS);
const COMBO_CARD_B = new Uint8Array(NUM_COMBOS);
const COMBO_TO_HAND = new Uint8Array(NUM_COMBOS);
const HAND_TO_COMBOS: number[][] = Array.from({ length: NUM_HANDS }, () => []);

(function buildComboTables() {
  for (let hi = 1; hi < NUM_CARDS; hi++) {
    for (let lo = 0; lo < hi; lo++) {
      const idx = (hi * (hi - 1)) / 2 + lo;
      COMBO_CARD_A[idx] = lo;
      COMBO_CARD_B[idx] = hi;

      const rHi = rankOf(hi);
      const rLo = rankOf(lo);
      const suited = suitOf(hi) === suitOf(lo);
      const bigRank = Math.max(rHi, rLo);
      const smallRank = Math.min(rHi, rLo);
      const bigPos = NUM_RANKS - 1 - bigRank;
      const smallPos = NUM_RANKS - 1 - smallRank;

      let handIdx: number;
      if (bigRank === smallRank) handIdx = gridToHandIndex(bigPos, bigPos);
      else if (suited) handIdx = gridToHandIndex(bigPos, smallPos);
      else handIdx = gridToHandIndex(smallPos, bigPos);

      COMBO_TO_HAND[idx] = handIdx;
      HAND_TO_COMBOS[handIdx]!.push(idx);
    }
  }
})();

export function comboCards(combo: number): [Card, Card] {
  return [COMBO_CARD_A[combo]!, COMBO_CARD_B[combo]!];
}

export function comboToHandIndex(combo: number): number {
  return COMBO_TO_HAND[combo]!;
}

/** 페어 6개, 수딧 4개, 오프수트 12개. */
export function combosOfHand(handIndex: number): readonly number[] {
  return HAND_TO_COMBOS[handIndex]!;
}

export function comboCountOf(shape: HandShape): number {
  return shape === 'pair' ? 6 : shape === 'suited' ? 4 : 12;
}

// ---------------------------------------------------------------------------
// 레인지 자료구조
// ---------------------------------------------------------------------------

/** 169칸 각각의 비중(0~1). UI가 다루는 형태. */
export type HandRange = Float32Array;

/** 1326콤보 각각의 비중(0~1). 엔진이 다루는 형태. */
export type ComboRange = Float32Array;

export function emptyHandRange(): HandRange {
  return new Float32Array(NUM_HANDS);
}

export function emptyComboRange(): ComboRange {
  return new Float32Array(NUM_COMBOS);
}

/** 169 → 1326. 한 칸의 비중을 그 칸에 속한 콤보 전부에 그대로 복사한다. */
export function handRangeToCombos(hands: HandRange): ComboRange {
  const combos = emptyComboRange();
  for (let c = 0; c < NUM_COMBOS; c++) {
    combos[c] = hands[COMBO_TO_HAND[c]!]!;
  }
  return combos;
}

/** 1326 → 169. 칸 안 콤보들의 평균을 낸다. */
export function combosToHandRange(combos: ComboRange): HandRange {
  const hands = emptyHandRange();
  for (let h = 0; h < NUM_HANDS; h++) {
    const list = HAND_TO_COMBOS[h]!;
    let sum = 0;
    for (const c of list) sum += combos[c]!;
    hands[h] = sum / list.length;
  }
  return hands;
}

/** 레인지에 실제로 들어있는 콤보 수 (비중 가중). "레인지가 몇 콤보냐"를 말할 때 쓰는 값. */
export function comboWeightSum(combos: ComboRange): number {
  let sum = 0;
  for (let c = 0; c < NUM_COMBOS; c++) sum += combos[c]!;
  return sum;
}

/** 전체 1326 중 몇 %인지. 흔히 말하는 "레인지 몇 %". */
export function rangePercent(combos: ComboRange): number {
  return (comboWeightSum(combos) / NUM_COMBOS) * 100;
}

// ---------------------------------------------------------------------------
// 레인지 문자열 파서
// ---------------------------------------------------------------------------

/**
 * 포커 판에서 통용되는 레인지 표기를 읽는다.
 *
 *   "AA, KK, AKs"        낱개
 *   "77+"                77 이상 모든 페어
 *   "ATs+"               ATs~AKs (같은 하이카드, 킥커 상승)
 *   "A5s-A2s"            구간
 *   "AKo:0.5"            비중 50%로 섞기
 *   "QQ+, AKs, AQs+"     조합
 */
export function parseRange(text: string): HandRange {
  const range = emptyHandRange();
  const tokens = text
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const token of tokens) {
    let body = token;
    let weight = 1;

    const colon = token.indexOf(':');
    if (colon >= 0) {
      body = token.slice(0, colon).trim();
      const parsed = Number(token.slice(colon + 1).trim());
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
        throw new Error(`비중은 0~1이어야 합니다: "${token}"`);
      }
      weight = parsed;
    }

    for (const handIdx of expandToken(body)) {
      range[handIdx] = weight;
    }
  }
  return range;
}

function expandToken(token: string): number[] {
  if (token.includes('-')) {
    const [fromText, toText] = token.split('-').map((s) => s.trim());
    if (!fromText || !toText) throw new Error(`구간 표기가 올바르지 않습니다: "${token}"`);
    return expandDashRange(fromText, toText);
  }
  if (token.endsWith('+')) {
    return expandPlus(token.slice(0, -1).trim());
  }
  return [handStringToIndex(token)];
}

function expandPlus(base: string): number[] {
  const idx = handStringToIndex(base);
  const shape = handShape(idx);
  const out: number[] = [];

  if (shape === 'pair') {
    // 77+ → 77부터 AA까지
    const { row } = handIndexToGrid(idx);
    for (let p = row; p >= 0; p--) out.push(gridToHandIndex(p, p));
    return out;
  }

  // ATs+ → 하이카드 고정, 킥커를 하이카드 바로 아래까지 올린다
  const { row, col } = handIndexToGrid(idx);
  const highPos = Math.min(row, col);
  const kickerPos = Math.max(row, col);
  for (let k = kickerPos; k > highPos; k--) {
    out.push(shape === 'suited' ? gridToHandIndex(highPos, k) : gridToHandIndex(k, highPos));
  }
  return out;
}

function expandDashRange(fromText: string, toText: string): number[] {
  const a = handStringToIndex(fromText);
  const b = handStringToIndex(toText);
  const shapeA = handShape(a);
  const shapeB = handShape(b);
  if (shapeA !== shapeB) throw new Error(`구간의 양끝 모양이 다릅니다: "${fromText}-${toText}"`);

  if (shapeA === 'pair') {
    const pa = handIndexToGrid(a).row;
    const pb = handIndexToGrid(b).row;
    const lo = Math.min(pa, pb);
    const hi = Math.max(pa, pb);
    const out: number[] = [];
    for (let p = lo; p <= hi; p++) out.push(gridToHandIndex(p, p));
    return out;
  }

  const ga = handIndexToGrid(a);
  const gb = handIndexToGrid(b);
  const highA = Math.min(ga.row, ga.col);
  const highB = Math.min(gb.row, gb.col);
  if (highA !== highB) throw new Error(`구간의 하이카드가 다릅니다: "${fromText}-${toText}"`);

  const ka = Math.max(ga.row, ga.col);
  const kb = Math.max(gb.row, gb.col);
  const lo = Math.min(ka, kb);
  const hi = Math.max(ka, kb);
  const out: number[] = [];
  for (let k = lo; k <= hi; k++) {
    out.push(shapeA === 'suited' ? gridToHandIndex(highA, k) : gridToHandIndex(k, highA));
  }
  return out;
}

/** 레인지를 다시 사람이 읽는 문자열로. 연속 구간은 묶어서 압축한다. */
export function formatRange(range: HandRange): string {
  const parts: string[] = [];
  const used = new Uint8Array(NUM_HANDS);

  // 페어부터: 연속 구간을 하나로 묶는다.
  for (let p = 0; p < NUM_RANKS; p++) {
    const idx = gridToHandIndex(p, p);
    if (used[idx] || range[idx]! <= 0) continue;
    const w = range[idx]!;
    let end = p;
    while (end + 1 < NUM_RANKS) {
      const next = gridToHandIndex(end + 1, end + 1);
      if (range[next]! !== w) break;
      end++;
    }
    for (let q = p; q <= end; q++) used[gridToHandIndex(q, q)] = 1;
    const label =
      p === end
        ? handIndexToString(idx)
        : `${handIndexToString(gridToHandIndex(end, end))}-${handIndexToString(idx)}`;
    parts.push(withWeight(label, w));
  }

  // 수딧/오프수트: 하이카드별로 킥커 연속 구간을 묶는다.
  for (const suited of [true, false]) {
    for (let high = 0; high < NUM_RANKS; high++) {
      for (let k = high + 1; k < NUM_RANKS; k++) {
        const idx = suited ? gridToHandIndex(high, k) : gridToHandIndex(k, high);
        if (used[idx] || range[idx]! <= 0) continue;
        const w = range[idx]!;
        let end = k;
        while (end + 1 < NUM_RANKS) {
          const next = suited ? gridToHandIndex(high, end + 1) : gridToHandIndex(end + 1, high);
          if (range[next]! !== w) break;
          end++;
        }
        for (let q = k; q <= end; q++) {
          used[suited ? gridToHandIndex(high, q) : gridToHandIndex(q, high)] = 1;
        }
        const first = handIndexToString(idx);
        const last = handIndexToString(
          suited ? gridToHandIndex(high, end) : gridToHandIndex(end, high),
        );
        parts.push(withWeight(k === end ? first : `${first}-${last}`, w));
      }
    }
  }

  return parts.join(', ');
}

function withWeight(label: string, weight: number): string {
  return weight >= 1 ? label : `${label}:${Number(weight.toFixed(3))}`;
}

/** 보드/데드카드와 겹치는 콤보를 0으로 만든다. 블로커 처리의 핵심. */
export function removeBlockedCombos(combos: ComboRange, deadCards: readonly Card[]): ComboRange {
  const out = combos.slice() as ComboRange;
  const dead = new Uint8Array(NUM_CARDS);
  for (const c of deadCards) dead[c] = 1;
  for (let i = 0; i < NUM_COMBOS; i++) {
    if (out[i] === 0) continue;
    if (dead[COMBO_CARD_A[i]!] || dead[COMBO_CARD_B[i]!]) out[i] = 0;
  }
  return out;
}

/** 디버깅/테스트용: 카드 두 장을 콤보 인덱스로 바꾸는 짧은 헬퍼. */
export function comboOf(rank1: number, suit1: number, rank2: number, suit2: number): number {
  return comboIndex(makeCard(rank1, suit1), makeCard(rank2, suit2));
}

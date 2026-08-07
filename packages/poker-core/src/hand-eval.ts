import { NUM_RANKS, rankOf, suitOf, type Card } from './cards';

/**
 * 5~7장 핸드 평가기.
 *
 * 반환값은 하나의 정수이고 클수록 강하다. 절대값에 의미는 없고 대소 비교만 쓴다.
 *   score = category * 2^20 + (5개 킥커 랭크를 4비트씩 팩킹)
 *
 * 룩업 테이블(2+2 등)을 쓰지 않는 이유: 솔버에서 이 함수는
 * "보드 하나당 1326번"만 호출된다. CFR 반복 루프 안이 아니다.
 * 100MB 테이블을 브라우저로 내려받는 비용이 이득보다 훨씬 크다.
 */

export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAMES_KO: Record<number, string> = {
  0: '하이카드',
  1: '원페어',
  2: '투페어',
  3: '트립스',
  4: '스트레이트',
  5: '플러시',
  6: '풀하우스',
  7: '포카드',
  8: '스트레이트 플러시',
};

const CATEGORY_SHIFT = 20;

/** 랭크 비트마스크에서 스트레이트의 top 랭크를 찾는다. 없으면 -1. */
function straightHigh(rankMask: number): number {
  for (let hi = NUM_RANKS - 1; hi >= 4; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((rankMask & need) === need) return hi;
  }
  // A2345 (휠). A는 랭크 12지만 5-high 스트레이트에서는 최하위로 쓰인다.
  const wheel = (1 << 12) | (1 << 3) | (1 << 2) | (1 << 1) | (1 << 0);
  if ((rankMask & wheel) === wheel) return 3; // 5-high
  return -1;
}

/** 마스크에서 높은 순으로 최대 n개 랭크를 뽑아 4비트씩 팩킹. */
function packTop(rankMask: number, n: number): number {
  let packed = 0;
  let taken = 0;
  for (let r = NUM_RANKS - 1; r >= 0 && taken < n; r--) {
    if (rankMask & (1 << r)) {
      packed = (packed << 4) | r;
      taken++;
    }
  }
  // 개수가 모자라면 하위 니블을 0으로 채워 자릿수를 맞춘다.
  while (taken < n) {
    packed <<= 4;
    taken++;
  }
  return packed;
}

function score(category: HandCategory, packedKickers: number): number {
  return category * (1 << CATEGORY_SHIFT) + packedKickers;
}

/**
 * 카드 배열(5~7장)을 평가한다. 배열 길이는 검사하지 않는다 — 핫패스이므로
 * 호출부가 보장한다.
 */
export function evaluate(cards: readonly Card[]): number {
  const rankCounts = new Int8Array(NUM_RANKS);
  const suitCounts = new Int8Array(4);
  const suitRankMask = new Int32Array(4);
  let rankMask = 0;

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const r = rankOf(c);
    const s = suitOf(c);
    rankCounts[r]++;
    suitCounts[s]++;
    suitRankMask[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  // 플러시 / 스트레이트 플러시
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCounts[s]! >= 5) {
      flushSuit = s;
      break;
    }
  }
  if (flushSuit >= 0) {
    const fMask = suitRankMask[flushSuit]!;
    const sfHigh = straightHigh(fMask);
    if (sfHigh >= 0) return score(HandCategory.StraightFlush, sfHigh);
    return score(HandCategory.Flush, packTop(fMask, 5));
  }

  // 랭크 중복 집계. 높은 랭크부터 훑어 첫 발견이 곧 최상위가 되게 한다.
  let quad = -1;
  let trips = -1;
  let trips2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = NUM_RANKS - 1; r >= 0; r--) {
    const n = rankCounts[r]!;
    if (n === 4) {
      if (quad < 0) quad = r;
    } else if (n === 3) {
      if (trips < 0) trips = r;
      else if (trips2 < 0) trips2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    const kicker = packTop(rankMask & ~(1 << quad), 1);
    return score(HandCategory.Quads, (quad << 4) | kicker);
  }

  // 풀하우스는 스트레이트보다 위라서 먼저 판정한다.
  if (trips >= 0 && (pair1 >= 0 || trips2 >= 0)) {
    // 트립스가 둘이면 낮은 쪽을 페어로 쓴다. 그 쪽이 항상 더 강하거나 같다.
    const pairPart = trips2 >= 0 && trips2 > pair1 ? trips2 : pair1;
    return score(HandCategory.FullHouse, (trips << 4) | pairPart);
  }

  const stHigh = straightHigh(rankMask);
  if (stHigh >= 0) return score(HandCategory.Straight, stHigh);

  if (trips >= 0) {
    const kickers = packTop(rankMask & ~(1 << trips), 2);
    return score(HandCategory.Trips, (trips << 8) | kickers);
  }

  if (pair2 >= 0) {
    const kicker = packTop(rankMask & ~(1 << pair1) & ~(1 << pair2), 1);
    return score(HandCategory.TwoPair, (pair1 << 8) | (pair2 << 4) | kicker);
  }

  if (pair1 >= 0) {
    const kickers = packTop(rankMask & ~(1 << pair1), 3);
    return score(HandCategory.Pair, (pair1 << 12) | kickers);
  }

  return score(HandCategory.HighCard, packTop(rankMask, 5));
}

export function categoryOf(scoreValue: number): HandCategory {
  return (scoreValue >> CATEGORY_SHIFT) as HandCategory;
}

export function describeHand(scoreValue: number): string {
  return CATEGORY_NAMES_KO[categoryOf(scoreValue)] ?? '알 수 없음';
}

/** 홀카드 2장 + 보드로 평가. 보드는 3~5장. */
export function evaluateWithBoard(c1: Card, c2: Card, board: readonly Card[]): number {
  const cards: Card[] = [c1, c2];
  for (let i = 0; i < board.length; i++) cards.push(board[i]!);
  return evaluate(cards);
}

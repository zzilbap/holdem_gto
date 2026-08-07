/**
 * 카드는 0..51 정수 하나로 표현한다.
 *   rank = card >> 2   (0 = 2, 12 = A)
 *   suit = card & 3    (0 = c, 1 = d, 2 = h, 3 = s)
 *
 * 정수로 두는 이유는 솔버 내부 루프가 전부 typed array 인덱싱이기 때문이다.
 * 객체를 쓰면 GC가 CFR 반복을 잡아먹는다.
 */

export type Card = number;
export type Rank = number;
export type Suit = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';

export const NUM_CARDS = 52;
export const NUM_RANKS = 13;
export const NUM_SUITS = 4;

export function makeCard(rank: Rank, suit: Suit): Card {
  return (rank << 2) | suit;
}

export function rankOf(card: Card): Rank {
  return card >> 2;
}

export function suitOf(card: Card): Suit {
  return card & 3;
}

/** "As" → 51, "2c" → 0 */
export function parseCard(text: string): Card {
  if (text.length !== 2) throw new Error(`카드 표기가 올바르지 않습니다: "${text}"`);
  const rank = RANKS.indexOf(text[0]!.toUpperCase());
  const suit = SUITS.indexOf(text[1]!.toLowerCase());
  if (rank < 0) throw new Error(`알 수 없는 랭크입니다: "${text[0]}"`);
  if (suit < 0) throw new Error(`알 수 없는 수트입니다: "${text[1]}"`);
  return makeCard(rank, suit);
}

export function formatCard(card: Card): string {
  return RANKS[rankOf(card)]! + SUITS[suitOf(card)]!;
}

/** "AsKd7h" 또는 "As Kd 7h" → [51, 46, 21] */
export function parseCards(text: string): Card[] {
  const cleaned = text.replace(/[\s,]/g, '');
  if (cleaned.length % 2 !== 0) throw new Error(`카드 문자열 길이가 홀수입니다: "${text}"`);
  const out: Card[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(parseCard(cleaned.slice(i, i + 2)));
  }
  const seen = new Set(out);
  if (seen.size !== out.length) throw new Error(`중복된 카드가 있습니다: "${text}"`);
  return out;
}

export function formatCards(cards: readonly Card[]): string {
  return cards.map(formatCard).join('');
}

/** 카드 집합을 52비트 마스크로. 겹침 판정을 O(1)로 만들기 위한 것. */
export function cardsToMask(cards: readonly Card[]): bigint {
  let mask = 0n;
  for (const c of cards) mask |= 1n << BigInt(c);
  return mask;
}

/**
 * 보드는 최대 5장이라 52비트가 필요하지만, bigint는 느리다.
 * 실전 루프에서는 카드가 항상 52개 미만이므로 하위/상위 26비트로 쪼갠 쌍을 쓴다.
 */
export type CardMask = { lo: number; hi: number };

export function emptyMask(): CardMask {
  return { lo: 0, hi: 0 };
}

export function maskAdd(mask: CardMask, card: Card): void {
  if (card < 26) mask.lo |= 1 << card;
  else mask.hi |= 1 << (card - 26);
}

export function maskHas(mask: CardMask, card: Card): boolean {
  return card < 26 ? (mask.lo & (1 << card)) !== 0 : (mask.hi & (1 << (card - 26))) !== 0;
}

export function maskOf(cards: readonly Card[]): CardMask {
  const m = emptyMask();
  for (const c of cards) maskAdd(m, c);
  return m;
}

export function masksOverlap(a: CardMask, b: CardMask): boolean {
  return (a.lo & b.lo) !== 0 || (a.hi & b.hi) !== 0;
}

export const FULL_DECK: readonly Card[] = Array.from({ length: NUM_CARDS }, (_, i) => i);

/** 주어진 카드들을 제외한 덱. 보드/블로커 처리용. */
export function deckExcluding(excluded: readonly Card[]): Card[] {
  const mask = maskOf(excluded);
  const out: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!maskHas(mask, c)) out.push(c);
  return out;
}

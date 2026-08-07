import { describe, expect, it } from 'vitest';
import { NUM_CARDS, parseCards } from './cards';
import { HandCategory, categoryOf, evaluate } from './hand-eval';

function score(text: string): number {
  return evaluate(parseCards(text));
}

function cat(text: string): HandCategory {
  return categoryOf(score(text));
}

describe('카테고리 판정', () => {
  it('각 족보를 올바르게 분류한다', () => {
    expect(cat('AsKsQsJsTs')).toBe(HandCategory.StraightFlush);
    expect(cat('5s4s3s2sAs')).toBe(HandCategory.StraightFlush); // 스틸 휠
    expect(cat('7c7d7h7sKs')).toBe(HandCategory.Quads);
    expect(cat('7c7d7hKsKd')).toBe(HandCategory.FullHouse);
    expect(cat('As9s7s4s2s')).toBe(HandCategory.Flush);
    expect(cat('9c8d7h6s5c')).toBe(HandCategory.Straight);
    expect(cat('Ac2d3h4s5c')).toBe(HandCategory.Straight); // 휠
    expect(cat('7c7d7hKsQd')).toBe(HandCategory.Trips);
    expect(cat('7c7dKsKdQh')).toBe(HandCategory.TwoPair);
    expect(cat('7c7dKsQd2h')).toBe(HandCategory.Pair);
    expect(cat('Ac9d7h4s2c')).toBe(HandCategory.HighCard);
  });

  it('AKQJT 오프수트는 스트레이트지 스트레이트플러시가 아니다', () => {
    expect(cat('AsKsQsJsTd')).toBe(HandCategory.Straight);
  });
});

describe('족보 간 우열', () => {
  const ordered = [
    'Ac9d7h4s2c', // 하이카드
    '7c7dKsQd2h', // 원페어
    '7c7dKsKdQh', // 투페어
    '7c7d7hKsQd', // 트립스
    '9c8d7h6s5c', // 스트레이트
    'As9s7s4s2s', // 플러시
    '7c7d7hKsKd', // 풀하우스
    '7c7d7h7sKs', // 포카드
    'AsKsQsJsTs', // 스트레이트 플러시
  ];

  it('낮은 족보부터 순서대로 강해진다', () => {
    for (let i = 1; i < ordered.length; i++) {
      expect(score(ordered[i]!)).toBeGreaterThan(score(ordered[i - 1]!));
    }
  });
});

describe('같은 족보 안에서의 비교', () => {
  it('킥커로 갈린다', () => {
    expect(score('AcAdKh7s2c')).toBeGreaterThan(score('AcAdQh7s2c'));
    expect(score('AcAdKhQs2c')).toBeGreaterThan(score('AcAdKhJs2c'));
  });

  it('높은 페어가 이긴다', () => {
    expect(score('AcAd5h4s3c')).toBeGreaterThan(score('KcKdQhJs9c'));
  });

  it('투페어는 위쪽 페어부터 본다', () => {
    expect(score('AcAd2h2sKc')).toBeGreaterThan(score('KcKdQhQsAc'));
  });

  it('스트레이트는 탑 랭크로 갈리고, 휠이 가장 낮다', () => {
    expect(score('9c8d7h6s5c')).toBeGreaterThan(score('8c7d6h5s4c'));
    expect(score('6c5d4h3s2c')).toBeGreaterThan(score('5c4d3h2sAc'));
  });

  it('풀하우스는 트립스 랭크가 우선이다', () => {
    expect(score('3c3d3h2s2c')).toBeGreaterThan(score('2c2d2hAcAd'));
  });

  it('플러시는 하이카드 순으로 비교한다', () => {
    expect(score('AsQs9s5s3s')).toBeGreaterThan(score('KsQs9s5s3s'));
    expect(score('AsQs9s5s3s')).toBeGreaterThan(score('AsJs9s5s3s'));
  });
});

describe('7장 평가', () => {
  it('7장 중 최고 5장을 고른다', () => {
    // 트립 A + 페어 2 → 두 페어가 아니라 풀하우스로 잡아야 한다
    expect(cat('AcAdAh2c2d9s4h')).toBe(HandCategory.FullHouse);
    // 9-T-J로 3연속뿐이라 스트레이트가 아니다
    expect(cat('Ac9d7h4s2cJhTd')).toBe(HandCategory.HighCard);
    // 스페이드 6장이면 그중 상위 5장이 플러시
    expect(cat('As9s7s4s2s3sKd')).toBe(HandCategory.Flush);
  });

  it('7장 평가는 5장 조합 중 최댓값과 일치한다', () => {
    const rng = mulberry32(12345);
    for (let trial = 0; trial < 300; trial++) {
      const cards = pickDistinct(rng, 7);
      const seven = evaluate(cards);
      let best = -1;
      for (const five of fiveOf(cards)) {
        const s = evaluate(five);
        if (s > best) best = s;
      }
      expect(seven).toBe(best);
    }
  });
});

describe('5장 전수 열거 빈도', () => {
  // 평가기가 진짜 맞는지 확인하는 가장 확실한 방법.
  // C(52,5) = 2,598,960 전부를 분류해서 교과서 빈도와 대조한다.
  it('교과서 확률 분포와 정확히 일치한다', () => {
    const counts = new Array(9).fill(0);
    const hand = new Array<number>(5);
    for (let a = 0; a < NUM_CARDS; a++) {
      hand[0] = a;
      for (let b = a + 1; b < NUM_CARDS; b++) {
        hand[1] = b;
        for (let c = b + 1; c < NUM_CARDS; c++) {
          hand[2] = c;
          for (let d = c + 1; d < NUM_CARDS; d++) {
            hand[3] = d;
            for (let e = d + 1; e < NUM_CARDS; e++) {
              hand[4] = e;
              counts[categoryOf(evaluate(hand))]++;
            }
          }
        }
      }
    }

    expect(counts[HandCategory.StraightFlush]).toBe(40);
    expect(counts[HandCategory.Quads]).toBe(624);
    expect(counts[HandCategory.FullHouse]).toBe(3744);
    expect(counts[HandCategory.Flush]).toBe(5108);
    expect(counts[HandCategory.Straight]).toBe(10200);
    expect(counts[HandCategory.Trips]).toBe(54912);
    expect(counts[HandCategory.TwoPair]).toBe(123552);
    expect(counts[HandCategory.Pair]).toBe(1098240);
    expect(counts[HandCategory.HighCard]).toBe(1302540);
  }, 120000);
});

// --- 테스트 헬퍼 -----------------------------------------------------------

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

function pickDistinct(rng: () => number, n: number): number[] {
  const seen = new Set<number>();
  while (seen.size < n) seen.add((rng() * NUM_CARDS) | 0);
  return [...seen];
}

function* fiveOf(cards: readonly number[]): Generator<number[]> {
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++)
            yield [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
}

import { describe, expect, it } from 'vitest';
import { parseCards } from './cards';
import {
  NUM_COMBOS,
  NUM_HANDS,
  combosOfHand,
  combosToHandRange,
  comboIndex,
  comboToHandIndex,
  formatRange,
  handIndexToString,
  handRangeToCombos,
  handShape,
  handStringToIndex,
  parseRange,
  rangePercent,
  removeBlockedCombos,
} from './range';

describe('169 핸드 인덱스', () => {
  it('좌상단이 AA, 우상단이 A2s, 좌하단이 A2o, 우하단이 22', () => {
    expect(handIndexToString(0)).toBe('AA');
    expect(handIndexToString(12)).toBe('A2s');
    expect(handIndexToString(12 * 13)).toBe('A2o');
    expect(handIndexToString(168)).toBe('22');
  });

  it('문자열 ↔ 인덱스 변환이 169칸 전부에서 왕복한다', () => {
    for (let i = 0; i < NUM_HANDS; i++) {
      expect(handStringToIndex(handIndexToString(i))).toBe(i);
    }
  });

  it('랭크 순서를 뒤집어 써도 같은 칸으로 간다', () => {
    expect(handStringToIndex('KAs')).toBe(handStringToIndex('AKs'));
    expect(handStringToIndex('kao')).toBe(handStringToIndex('AKo'));
  });

  it('잘못된 표기는 거부한다', () => {
    expect(() => handStringToIndex('AAs')).toThrow();
    expect(() => handStringToIndex('AK')).toThrow();
    expect(() => handStringToIndex('AKx')).toThrow();
    expect(() => handStringToIndex('1Ks')).toThrow();
  });
});

describe('콤보 매핑', () => {
  it('페어 6개, 수딧 4개, 오프수트 12개', () => {
    expect(combosOfHand(handStringToIndex('AA')).length).toBe(6);
    expect(combosOfHand(handStringToIndex('AKs')).length).toBe(4);
    expect(combosOfHand(handStringToIndex('AKo')).length).toBe(12);
  });

  it('169칸의 콤보 합이 정확히 1326이다', () => {
    let total = 0;
    for (let i = 0; i < NUM_HANDS; i++) total += combosOfHand(i).length;
    expect(total).toBe(NUM_COMBOS);
  });

  it('모든 콤보가 자기 칸으로 되돌아온다', () => {
    for (let i = 0; i < NUM_HANDS; i++) {
      for (const combo of combosOfHand(i)) {
        expect(comboToHandIndex(combo)).toBe(i);
      }
    }
  });

  it('AsKs는 AKs 칸, AsKh는 AKo 칸', () => {
    const [as, ks] = parseCards('AsKs');
    const [as2, kh] = parseCards('AsKh');
    expect(handIndexToString(comboToHandIndex(comboIndex(as!, ks!)))).toBe('AKs');
    expect(handIndexToString(comboToHandIndex(comboIndex(as2!, kh!)))).toBe('AKo');
  });

  it('카드 순서를 바꿔도 같은 콤보', () => {
    const [a, b] = parseCards('AsKh');
    expect(comboIndex(a!, b!)).toBe(comboIndex(b!, a!));
  });
});

describe('레인지 문자열 파서', () => {
  const listOf = (text: string) => {
    const r = parseRange(text);
    const out: string[] = [];
    for (let i = 0; i < NUM_HANDS; i++) if (r[i]! > 0) out.push(handIndexToString(i));
    return out.sort();
  };

  it('낱개를 읽는다', () => {
    expect(listOf('AA, KK, AKs')).toEqual(['AA', 'AKs', 'KK'].sort());
  });

  it('페어 + 는 위로 확장한다', () => {
    expect(listOf('TT+')).toEqual(['AA', 'KK', 'QQ', 'JJ', 'TT'].sort());
  });

  it('수딧 + 는 킥커를 올린다', () => {
    expect(listOf('ATs+')).toEqual(['AKs', 'AQs', 'AJs', 'ATs'].sort());
  });

  it('오프수트 + 도 마찬가지', () => {
    expect(listOf('KTo+')).toEqual(['KQo', 'KJo', 'KTo'].sort());
  });

  it('구간 표기를 읽는다', () => {
    expect(listOf('A5s-A2s')).toEqual(['A5s', 'A4s', 'A3s', 'A2s'].sort());
    expect(listOf('99-66')).toEqual(['99', '88', '77', '66'].sort());
  });

  it('비중을 읽는다', () => {
    const r = parseRange('AKo:0.5, AA');
    expect(r[handStringToIndex('AKo')]).toBeCloseTo(0.5);
    expect(r[handStringToIndex('AA')]).toBe(1);
  });

  it('전 레인지는 100%다', () => {
    const all = parseRange('22+, A2s+, K2s+, Q2s+, J2s+, T2s+, 92s+, 82s+, 72s+, 62s+, 52s+, 42s+, 32s, A2o+, K2o+, Q2o+, J2o+, T2o+, 92o+, 82o+, 72o+, 62o+, 52o+, 42o+, 32o');
    let count = 0;
    for (let i = 0; i < NUM_HANDS; i++) if (all[i]! > 0) count++;
    expect(count).toBe(NUM_HANDS);
    expect(rangePercent(handRangeToCombos(all))).toBeCloseTo(100);
  });

  it('구간 양끝의 모양이 다르면 거부한다', () => {
    expect(() => parseRange('A5s-A2o')).toThrow();
    expect(() => parseRange('AKs-KQs')).toThrow();
  });
});

describe('169 ↔ 1326 변환', () => {
  it('왕복해도 값이 보존된다', () => {
    const hands = parseRange('QQ+, AKs, AKo:0.4');
    const back = combosToHandRange(handRangeToCombos(hands));
    for (let i = 0; i < NUM_HANDS; i++) {
      expect(back[i]).toBeCloseTo(hands[i]!, 5);
    }
  });

  it('레인지 비중을 % 로 환산한다', () => {
    // AA만 = 6콤보 / 1326
    expect(rangePercent(handRangeToCombos(parseRange('AA')))).toBeCloseTo((6 / 1326) * 100, 5);
  });
});

describe('블로커 제거', () => {
  it('보드와 겹치는 콤보를 지운다', () => {
    const combos = handRangeToCombos(parseRange('AA'));
    const board = parseCards('AsKd7h');
    const filtered = removeBlockedCombos(combos, board);

    let remaining = 0;
    for (let c = 0; c < NUM_COMBOS; c++) if (filtered[c]! > 0) remaining++;
    // As가 빠지면 AA 6콤보 중 As가 든 3개가 사라진다
    expect(remaining).toBe(3);
  });
});

describe('레인지 → 문자열 되쓰기', () => {
  it('압축한 문자열을 다시 읽으면 원래 레인지가 나온다', () => {
    for (const text of ['QQ+, AKs, AJs+', '77+, A2s+, KTo+', 'AA', '32o']) {
      const original = parseRange(text);
      const roundTrip = parseRange(formatRange(original));
      for (let i = 0; i < NUM_HANDS; i++) {
        expect(roundTrip[i]).toBeCloseTo(original[i]!, 5);
      }
    }
  });

  it('비중도 살려서 되쓴다', () => {
    const original = parseRange('AKo:0.5, AA');
    const roundTrip = parseRange(formatRange(original));
    expect(roundTrip[handStringToIndex('AKo')]).toBeCloseTo(0.5, 3);
  });
});

describe('핸드 모양 판정', () => {
  it('페어/수딧/오프수트를 구분한다', () => {
    expect(handShape(handStringToIndex('AA'))).toBe('pair');
    expect(handShape(handStringToIndex('AKs'))).toBe('suited');
    expect(handShape(handStringToIndex('AKo'))).toBe('offsuit');
  });
});

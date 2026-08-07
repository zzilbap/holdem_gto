import { NUM_HANDS, handStringToIndex } from '@holdem/poker-core';
import { describe, expect, it } from 'vitest';
import {
  buildPreflopEquityTable,
  collisionMatrix,
  packEquityTable,
  unpackEquityTable,
} from './equity-table';

describe('충돌 계수 표', () => {
  const collision = collisionMatrix();
  const at = (a: string, b: string) => collision[handStringToIndex(a) * NUM_HANDS + handStringToIndex(b)]!;

  it('겹치지 않는 핸드는 콤보 수 그대로다', () => {
    expect(at('AA', 'KK')).toBeCloseTo(6, 5); // 페어 6콤보
    expect(at('AA', 'KQs')).toBeCloseTo(4, 5); // 수딧 4콤보
    expect(at('AA', 'KQo')).toBeCloseTo(12, 5); // 오프수트 12콤보
  });

  it('같은 페어는 6이 아니라 1이다', () => {
    // 내가 AsAh를 들면 상대 AA는 AdAc 하나뿐
    expect(at('AA', 'AA')).toBeCloseTo(1, 5);
  });

  it('에이스를 하나 쓰면 상대 AA가 6에서 3으로 준다', () => {
    // 남은 에이스 3장에서 2장 고르기 = 3
    expect(at('AKs', 'AA')).toBeCloseTo(3, 5);
    expect(at('AKo', 'AA')).toBeCloseTo(3, 5);
  });

  it('같은 수딧 핸드는 4에서 3으로 준다', () => {
    expect(at('AKs', 'AKs')).toBeCloseTo(3, 5);
  });

  it('표는 대칭적이다 — 콤보 수 비율로 환산하면 같은 쌍의 수가 나온다', () => {
    // collision[i][j] * (i의 콤보 수) == collision[j][i] * (j의 콤보 수)
    const comboCount = (h: string) => (h.length === 2 ? 6 : h.endsWith('s') ? 4 : 12);
    for (const [a, b] of [
      ['AA', 'AKs'],
      ['AKo', 'KQs'],
      ['77', '76s'],
    ] as const) {
      expect(at(a, b) * comboCount(a)).toBeCloseTo(at(b, a) * comboCount(b), 4);
    }
  });
});

describe('프리플롭 에퀴티 표', () => {
  /**
   * 보드 수가 곧 유효 표본 수다. 한 보드에서 뽑은 58만 개 쌍은 서로 독립이 아니라
   * (같은 5장을 공유한다) 표본을 늘리려면 쌍이 아니라 보드를 늘려야 한다.
   * 이걸 착각하면 400보드에서 AA vs KK가 84.6%로 나오는 걸 버그로 오해하게 된다.
   */
  const table = buildPreflopEquityTable({ boardSamples: 3000, seed: 20240807 });
  const eq = (a: string, b: string) =>
    table[handStringToIndex(a) * NUM_HANDS + handStringToIndex(b)]! * 100;

  it('양방향 합이 100%다', () => {
    for (const [a, b] of [
      ['AA', 'KK'],
      ['AKs', 'QQ'],
      ['72o', 'JTs'],
    ] as const) {
      expect(eq(a, b) + eq(b, a)).toBeCloseTo(100, 1);
    }
  });

  it('알려진 매치업 수치와 맞는다', () => {
    /**
     * 기대값은 "AA vs AKs 87.2%" 같이 흔히 인용되는 숫자가 아니라 **169 추상화 평균**이다.
     * 인용되는 값은 대개 수트 조합 하나(AhAd vs AsKs 등)를 잰 것이라 우리 표와 다르다.
     * 특히 JTs vs AA는 인용값 22.9%지만 24개 조합 평균은 21.2%다 — AA가 JTs의 수트를
     * 들고 있는 경우가 섞이면서 플러시 가치가 깎이기 때문이다.
     * 아래 숫자는 콤보를 전부 돌려 따로 계산해 얻었다.
     */
    // 허용 오차 2%p. 보드 3000개 기준 표준오차가 약 0.9%p이므로 2σ 남짓이다.
    const check = (a: string, b: string, expected: number) => {
      expect(eq(a, b), `${a} vs ${b}`).toBeGreaterThan(expected - 2);
      expect(eq(a, b), `${a} vs ${b}`).toBeLessThan(expected + 2);
    };

    check('AA', 'KK', 81.98);
    check('AA', '72o', 88.18);
    check('AA', 'AKs', 87.82);
    check('KK', 'AKs', 65.9);
    check('QQ', 'AKs', 53.8);
    check('QQ', 'AKo', 56.6);
    check('AKs', '22', 49.94);
    check('JTs', 'AA', 21.21);
  });

  it('같은 핸드끼리는 50%다', () => {
    for (const h of ['AA', 'AKs', '76o']) {
      expect(eq(h, h)).toBeCloseTo(50, 0);
    }
  });

  it('수딧이 같은 오프수트보다 항상 세다', () => {
    for (const [s, o] of [
      ['AKs', 'AKo'],
      ['JTs', 'JTo'],
      ['A5s', 'A5o'],
    ] as const) {
      expect(eq(s, 'QQ')).toBeGreaterThan(eq(o, 'QQ'));
    }
  });

  it('양자화해서 저장했다 읽어도 값이 보존된다', () => {
    const restored = unpackEquityTable(packEquityTable(table));
    for (let i = 0; i < table.length; i += 97) {
      expect(restored[i]).toBeCloseTo(table[i]!, 4);
    }
  });
});

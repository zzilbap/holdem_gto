import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  comboIndex,
  comboToHandIndex,
  handIndexToString,
  handStringToIndex,
} from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { parsePreflopData, type PreflopData, type PreflopDataFile } from './preflop-data';
import { describeTable } from './table-view';
import { getAdvice } from './scenario';
import {
  EMPTY_STATS,
  accuracyOf,
  applyResult,
  gradeAnswer,
  generateQuestion,
  type TrainerQuestion,
} from './trainer';

/**
 * 연습 기능 검증.
 *
 * 핵심은 채점이다. GTO는 같은 패를 섞어 치기도 하므로 "70% 레이즈 / 30% 폴드"인
 * 패를 폴드했다고 틀렸다며 혼내면 안 된다. 그렇다고 빈도 0인 선택까지
 * 봐주면 연습이 되지 않는다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../public/data/preflop-6max-100bb.json');

let data: PreflopData;

beforeAll(() => {
  data = parsePreflopData(JSON.parse(readFileSync(DATA_PATH, 'utf8')) as PreflopDataFile);
});

/** 특정 상황·패로 문제를 손수 만든다. 무작위 출제와 별개로 채점만 보기 위한 것. */
function questionFor(hand: string, scenario: TrainerQuestion['scenario']): TrainerQuestion {
  const handIndex = handStringToIndex(hand);
  const advice = getAdvice(data, scenario, handIndex);
  if (!advice) throw new Error('조언이 없습니다');
  return {
    id: 'test',
    scenario,
    handIndex,
    cards: [0, 1],
    options: advice.options,
  };
}

describe('문제 출제', () => {
  it('조건 없이도 문제가 나온다', () => {
    const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(1));
    expect(question).not.toBeNull();
  });

  it('고른 자리에서만 나온다', () => {
    for (let i = 0; i < 30; i++) {
      const question = generateQuestion(data, { positions: ['BTN'], kinds: [] }, seeded(i + 1));
      if (!question) continue;
      expect(question.scenario.hero).toBe('BTN');
    }
  });

  it('고른 상황 종류에서만 나온다', () => {
    for (let i = 0; i < 30; i++) {
      const question = generateQuestion(data, { positions: [], kinds: ['open'] }, seeded(i + 7));
      if (!question) continue;
      expect(question.scenario.kind).toBe('open');
    }
  });

  it('선택지가 둘 이상이다', () => {
    for (let i = 0; i < 20; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 40));
      if (!question) continue;
      expect(question.options.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('나온 카드가 그 핸드와 맞는다', () => {
    for (let i = 0; i < 20; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 100));
      if (!question) continue;
      const combo = comboIndex(question.cards[0], question.cards[1]);
      expect(comboToHandIndex(combo)).toBe(question.handIndex);
    }
  });

  it('나올 일 없는 상황은 문제로 내지 않는다', () => {
    // UTG가 오픈하지 않는 패로 "3벳 맞았을 때"를 물으면 답이 없다.
    for (let i = 0; i < 40; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 200));
      if (!question) continue;
      const advice = getAdvice(data, question.scenario, question.handIndex);
      expect(advice?.unreachable ?? true).toBe(false);
    }
  });
});

describe('채점', () => {
  it('항상 레이즈하는 패를 레이즈하면 정확하다', () => {
    const question = questionFor('AA', { kind: 'open', hero: 'BTN' });
    const result = gradeAnswer(question, 'raise');
    expect(result.grade).toBe('best');
    console.log(`\n  [BTN AA · 레이즈] ${result.headline} — ${result.detail}`);
  });

  it('항상 레이즈하는 패를 폴드하면 틀린 것이다', () => {
    const question = questionFor('AA', { kind: 'open', hero: 'BTN' });
    const result = gradeAnswer(question, 'fold');
    expect(result.grade).toBe('wrong');
    console.log(`  [BTN AA · 폴드] ${result.headline} — ${result.detail}`);
  });

  it('항상 접는 패를 접으면 정확하다', () => {
    const question = questionFor('72o', { kind: 'open', hero: 'UTG' });
    const result = gradeAnswer(question, 'fold');
    expect(result.grade).toBe('best');
  });

  it('섞어 치는 패는 어느 쪽을 골라도 혼내지 않는다', () => {
    // 빈도가 갈리는 패를 여러 자리에서 찾아, 덜 자주 쓰는 쪽을 골라본다.
    let checked = 0;
    const spots: TrainerQuestion['scenario'][] = [
      { kind: 'open', hero: 'CO' },
      { kind: 'open', hero: 'BTN' },
      { kind: 'vs-open', hero: 'BB', villain: 'BTN' },
      { kind: 'vs-open', hero: 'BTN', villain: 'UTG' },
    ];

    for (const scenario of spots) {
      for (let h = 0; h < 169 && checked < 3; h++) {
        const advice = getAdvice(data, scenario, h);
        if (!advice || advice.unreachable || !advice.isMixed) continue;

        const minor = [...advice.options]
          .filter((option) => option.frequency >= 0.1)
          .sort((a, b) => a.frequency - b.frequency)[0];
        if (!minor) continue;

        const question: TrainerQuestion = {
          id: 'mixed',
          scenario,
          handIndex: h,
          cards: [0, 1],
          options: advice.options,
        };
        const result = gradeAnswer(question, minor.kind);
        expect(result.grade, `${handIndexToString(h)} / ${minor.kind}`).not.toBe('wrong');
        if (checked === 0) console.log(`  [섞어 치는 패] ${result.headline} — ${result.detail}`);
        checked++;
      }
    }
    console.log(`  섞어 치는 패 ${checked}개 확인\n`);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('성적 집계', () => {
  it('정확도는 해법에 있는 선택의 비율이다', () => {
    let stats = EMPTY_STATS;
    stats = applyResult(stats, 'best');
    stats = applyResult(stats, 'mixed');
    stats = applyResult(stats, 'wrong');
    stats = applyResult(stats, 'best');
    expect(stats.answered).toBe(4);
    expect(accuracyOf(stats)).toBeCloseTo(75, 5);
  });

  it('섞어 치는 쪽을 골라도 연속 기록이 이어진다', () => {
    let stats = EMPTY_STATS;
    stats = applyResult(stats, 'best');
    stats = applyResult(stats, 'mixed');
    expect(stats.streak).toBe(2);
  });

  it('해법에 없는 선택을 하면 연속이 끊긴다', () => {
    let stats = EMPTY_STATS;
    stats = applyResult(stats, 'best');
    stats = applyResult(stats, 'best');
    stats = applyResult(stats, 'wrong');
    expect(stats.streak).toBe(0);
    expect(stats.bestStreak).toBe(2);
  });
});

/** 결정적인 난수. 테스트가 실행할 때마다 달라지면 안 된다. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('한국어 조사', () => {
  it('받침에 따라 이/가를 맞춘다', () => {
    // "레이즈이 더 자주" 같은 문장이 나오면 안 된다.
    const messages: string[] = [];
    const spots: TrainerQuestion['scenario'][] = [
      { kind: 'open', hero: 'CO' },
      { kind: 'open', hero: 'BTN' },
      { kind: 'vs-open', hero: 'BB', villain: 'BTN' },
      { kind: 'vs-open', hero: 'BTN', villain: 'CO' },
    ];

    for (const scenario of spots) {
      for (let h = 0; h < 169; h++) {
        const advice = getAdvice(data, scenario, h);
        if (!advice || advice.unreachable) continue;
        for (const option of advice.options) {
          const question: TrainerQuestion = {
            id: 'x',
            scenario,
            handIndex: h,
            cards: [0, 1],
            options: advice.options,
          };
          messages.push(gradeAnswer(question, option.kind).detail);
        }
      }
    }

    /**
     * 받침이 없으면 가/는, 있으면 이/은이다.
     *   레이즈·폴드·체크 → 받침 없음 → "레이즈가", "폴드는"
     *   콜·올인          → 받침 있음 → "콜이", "올인은"
     */
    const wrongForms = [
      '레이즈이',
      '레이즈은',
      '폴드이',
      '폴드은',
      '체크이',
      '체크은',
      '콜가',
      '콜는',
      '올인가',
      '올인는',
    ];
    const broken = messages.filter((message) => wrongForms.some((form) => message.includes(form)));
    console.log(`\n  문장 ${messages.length}개 검사 · 어색한 조사 ${broken.length}개`);
    if (broken.length > 0) console.log(`  예: ${broken[0]}`);
    expect(broken).toHaveLength(0);
  });
});

describe('테이블 그림', () => {
  it('모든 자리에 상태가 채워진다', () => {
    // 빈칸으로 남은 자리가 있으면 "얘는 뭘 한 거지?"에서 막힌다.
    const scenarios: TrainerQuestion['scenario'][] = [
      { kind: 'open', hero: 'CO' },
      { kind: 'vs-open', hero: 'BTN', villain: 'UTG' },
      { kind: 'vs-3bet', hero: 'HJ', villain: 'BTN' },
      { kind: 'vs-4bet', hero: 'BTN', villain: 'HJ' },
    ];

    for (const scenario of scenarios) {
      const question: TrainerQuestion = {
        id: 't',
        scenario,
        handIndex: handStringToIndex('AKo'),
        cards: [0, 1],
        options: [],
      };
      const table = describeTable(scenario, data);
      for (const position of ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const) {
        expect(table.seats[position], `${scenario.kind} / ${position}`).toBeDefined();
        expect(['folded', 'pending', 'live']).toContain(table.seats[position].status);
      }
    }
  });

  it('3벳·4벳 팟에서는 아직 행동 안 한 자리가 없다', () => {
    // 3벳까지 오갔으면 뒷자리도 이미 답을 마쳤다.
    for (const scenario of [
      { kind: 'vs-3bet', hero: 'HJ', villain: 'BTN' },
      { kind: 'vs-4bet', hero: 'BTN', villain: 'HJ' },
    ] as TrainerQuestion['scenario'][]) {
      const question: TrainerQuestion = {
        id: 't',
        scenario,
        handIndex: handStringToIndex('AKo'),
        cards: [0, 1],
        options: [],
      };
      const table = describeTable(scenario, data);
      const pending = Object.values(table.seats).filter((seat) => seat.status === 'pending');
      expect(pending).toHaveLength(0);
    }
  });

  it('팟이 자리에 놓인 돈의 합과 같다', () => {
    // 팟을 따로 계산하면 어긋난다. 실제로 4벳 팟이 20.5bb로 잘못 떴었다.
    const scenarios: TrainerQuestion['scenario'][] = [
      { kind: 'open', hero: 'CO' },
      { kind: 'vs-open', hero: 'BB', villain: 'BTN' },
      { kind: 'vs-3bet', hero: 'HJ', villain: 'BTN' },
      { kind: 'vs-4bet', hero: 'BTN', villain: 'HJ' },
    ];

    for (const scenario of scenarios) {
      const question: TrainerQuestion = {
        id: 't',
        scenario,
        handIndex: handStringToIndex('AKo'),
        cards: [0, 1],
        options: [],
      };
      const table = describeTable(scenario, data);
      const total = Object.values(table.seats).reduce((sum, seat) => sum + (seat.invested ?? 0), 0);
      expect(table.pot, scenario.kind).toBeCloseTo(total, 5);
    }
  });

  it('4벳 팟의 금액이 실제와 맞는다', () => {
    // HJ 2.5 오픈 → BTN 7.5 3벳 → HJ 16.5 4벳. 블라인드 1.5는 접힌 채로 남는다.
    const table = describeTable({ kind: 'vs-4bet', hero: 'BTN', villain: 'HJ' }, data);
    console.log(
      `\n  [4벳 팟] 팟 ${table.pot}bb · HJ ${table.seats.HJ.invested}bb · BTN ${table.seats.BTN.invested}bb`,
    );
    expect(table.seats.HJ.invested).toBeCloseTo(16.5, 5);
    expect(table.seats.BTN.invested).toBeCloseTo(7.5, 5);
    expect(table.pot).toBeCloseTo(25.5, 5); // 16.5 + 7.5 + 블라인드 1.5
  });
});

describe('버튼 순서', () => {
  it('정답이 항상 첫 번째 버튼이 아니다', () => {
    /**
     * 조언 화면은 빈도 내림차순으로 정렬해 보여준다. 그걸 그대로 연습 버튼에 쓰면
     * 첫 버튼이 늘 정답이 되어 위치만 보고 찍을 수 있다. 실제로 그랬다.
     */
    const bestPositions = new Map<number, number>();
    let sampled = 0;

    for (let i = 0; i < 300; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 1));
      if (!question) continue;
      const bestIndex = question.options.reduce(
        (best, option, index) =>
          option.frequency > question.options[best]!.frequency ? index : best,
        0,
      );
      bestPositions.set(bestIndex, (bestPositions.get(bestIndex) ?? 0) + 1);
      sampled++;
    }

    const spread = [...bestPositions.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, count]) => `${index}번 ${((count / sampled) * 100).toFixed(0)}%`)
      .join(' · ');
    console.log(`\n  정답 위치 분포 (${sampled}문제) — ${spread}`);

    // 한 자리에 몰려 있으면 위치로 찍을 수 있다는 뜻이다.
    expect(bestPositions.size).toBeGreaterThan(1);
    const topShare = Math.max(...bestPositions.values()) / sampled;
    expect(topShare).toBeLessThan(0.9);
  });

  it('버튼이 실전 순서대로 놓인다', () => {
    const order = ['fold', 'check', 'call', 'raise', 'allin'];
    for (let i = 0; i < 60; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 500));
      if (!question) continue;
      const indices = question.options.map((option) => order.indexOf(option.kind));
      for (let k = 1; k < indices.length; k++) {
        expect(indices[k]!, `${question.options.map((o) => o.kind).join(',')}`).toBeGreaterThan(
          indices[k - 1]!,
        );
      }
    }
  });

  it('폴드가 있으면 언제나 맨 앞이다', () => {
    for (let i = 0; i < 60; i++) {
      const question = generateQuestion(data, { positions: [], kinds: [] }, seeded(i + 900));
      if (!question) continue;
      const foldIndex = question.options.findIndex((option) => option.kind === 'fold');
      if (foldIndex >= 0) expect(foldIndex).toBe(0);
    }
  });
});

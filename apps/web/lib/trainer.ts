import {
  comboCards,
  combosOfHand,
  handIndexToString,
  type Card,
} from '@holdem/poker-core';
import { POSITIONS_6MAX, type Position } from '@holdem/solver';

import { subject, topic } from './korean';
import type { PreflopData } from './preflop-data';
import { getAdvice, listScenariosFor, scenarioTitle, type AdviceOption, type Scenario } from './scenario';

/**
 * 연습 문제 생성과 채점.
 *
 * 여기서 제일 까다로운 건 **정답이 하나가 아니라는 것**이다. GTO는 같은 패를
 * 70% 레이즈 / 30% 폴드로 섞어 치기도 한다. 그럼 폴드는 틀린 건가?
 *
 * 아니다. 빈도가 붙어 있으면 그것도 해법의 일부다. 그래서 맞다/틀리다 대신
 * 세 단계로 나눈다 — 주된 선택 / 섞어 치는 쪽 / 해법에 없는 선택.
 * 이렇게 해야 "가끔 폴드하는 패"를 폴드했다고 틀렸다며 혼내지 않는다.
 */

export type Grade = 'best' | 'mixed' | 'wrong';

export interface TrainerQuestion {
  id: string;
  scenario: Scenario;
  handIndex: number;
  /** 실제로 손에 든 두 장. 같은 AKo라도 무늬가 보이면 훨씬 실전 같다. */
  cards: [Card, Card];
  options: AdviceOption[];
}

export interface TrainerResult {
  question: TrainerQuestion;
  chosen: AdviceOption;
  /** 빈도가 가장 높은 선택. */
  best: AdviceOption;
  grade: Grade;
  headline: string;
  detail: string;
}

export interface TrainerFilter {
  /** 연습할 자리. 비어 있으면 전부. */
  positions: Position[];
  /** 연습할 상황 종류. 비어 있으면 전부. */
  kinds: Scenario['kind'][];
}

export const ALL_SCENARIO_KINDS: Array<{ kind: Scenario['kind']; label: string }> = [
  { kind: 'open', label: '오픈할지 말지' },
  { kind: 'vs-open', label: '앞사람 레이즈에 대응' },
  { kind: 'vs-3bet', label: '3벳 맞았을 때' },
  { kind: 'vs-4bet', label: '4벳 맞았을 때' },
];

/** 이 빈도 이상이면 "주된 선택"으로 본다. */
const BEST_MARGIN = 0.05;
/** 이 빈도 이상이면 "섞어 치는 쪽"으로 인정한다. */
const MIXED_THRESHOLD = 0.1;

/**
 * 버튼 순서는 실전 UI와 같아야 한다 — 폴드, 체크·콜, 레이즈, 올인.
 *
 * 조언 화면은 빈도가 높은 순으로 정렬해서 보여주는데, 그걸 그대로 연습 버튼에 쓰면
 * **첫 번째 버튼이 항상 정답이 된다.** 그러면 연습이 아니라 왼쪽 위 누르기가 된다.
 * 실제 포커 클라이언트와 같은 순서로 고정해야 위치로 답을 못 찍는다.
 */
const PLAY_ORDER: Record<string, number> = {
  fold: 0,
  check: 1,
  call: 2,
  raise: 3,
  allin: 4,
};

function inPlayOrder(options: readonly AdviceOption[]): AdviceOption[] {
  return [...options].sort(
    (a, b) => (PLAY_ORDER[a.kind] ?? 9) - (PLAY_ORDER[b.kind] ?? 9),
  );
}

export function generateQuestion(
  data: PreflopData,
  filter: TrainerFilter,
  random: () => number = Math.random,
): TrainerQuestion | null {
  const pool = buildScenarioPool(filter);
  if (pool.length === 0) return null;

  // 도달하지 않는 상황이 걸릴 수 있으니 몇 번 다시 뽑는다.
  for (let attempt = 0; attempt < 40; attempt++) {
    const scenario = pool[Math.floor(random() * pool.length)]!;
    const handIndex = pickHand(random);
    const advice = getAdvice(data, scenario, handIndex);
    if (!advice || advice.unreachable) continue;
    // 선택지가 하나뿐이면 문제가 되지 않는다.
    if (advice.options.length < 2) continue;

    const combos = combosOfHand(handIndex);
    const combo = combos[Math.floor(random() * combos.length)]!;

    return {
      id: `${scenario.kind}:${'villain' in scenario ? scenario.villain : ''}:${scenario.hero}:${combo}:${attempt}`,
      scenario,
      handIndex,
      cards: comboCards(combo),
      options: inPlayOrder(advice.options),
    };
  }
  return null;
}

function buildScenarioPool(filter: TrainerFilter): Scenario[] {
  const positions = filter.positions.length > 0 ? filter.positions : [...POSITIONS_6MAX];
  const kinds = filter.kinds.length > 0 ? filter.kinds : ALL_SCENARIO_KINDS.map((k) => k.kind);

  const pool: Scenario[] = [];
  for (const position of positions) {
    for (const scenario of listScenariosFor(position)) {
      if (kinds.includes(scenario.kind)) pool.push(scenario);
    }
  }
  return pool;
}

/**
 * 핸드를 콤보 수에 비례해 뽑는다.
 *
 * 169칸에서 균등하게 뽑으면 AA가 나올 확률이 실전의 6배가 된다.
 * 실전 감각을 익히는 게 목적이니 실제 분포를 따라야 한다.
 */
function pickHand(random: () => number): number {
  let target = random() * 1326;
  for (let h = 0; h < 169; h++) {
    target -= combosOfHand(h).length;
    if (target <= 0) return h;
  }
  return 168;
}

export function gradeAnswer(question: TrainerQuestion, chosenKind: string): TrainerResult {
  const chosen =
    question.options.find((option) => option.kind === chosenKind) ?? question.options[0]!;
  const best = question.options.reduce((a, b) => (b.frequency > a.frequency ? b : a));

  const grade: Grade =
    chosen.frequency >= best.frequency - BEST_MARGIN
      ? 'best'
      : chosen.frequency >= MIXED_THRESHOLD
        ? 'mixed'
        : 'wrong';

  const hand = handIndexToString(question.handIndex);
  const pct = (value: number) => `${Math.round(value * 100)}%`;

  if (grade === 'best') {
    return {
      question,
      chosen,
      best,
      grade,
      headline: '정확합니다',
      detail:
        best.frequency >= 0.95
          ? `${hand}는 이 상황에서 항상 ${best.name}입니다.`
          : `${hand}는 ${pct(best.frequency)}로 ${subject(best.name)} 주된 선택입니다.`,
    };
  }

  if (grade === 'mixed') {
    return {
      question,
      chosen,
      best,
      grade,
      headline: '이것도 씁니다',
      detail:
        `${hand}는 ${pct(chosen.frequency)}만큼 ${chosen.name}합니다. 틀린 건 아니지만 ` +
        `${pct(best.frequency)}로 ${subject(best.name)} 더 자주 나오는 선택입니다.`,
    };
  }

  return {
    question,
    chosen,
    best,
    grade,
    headline: '아쉽습니다',
    detail:
      chosen.frequency < 0.01
        ? `${hand}로 ${chosen.name}하는 경우는 해법에 없습니다. ${pct(best.frequency)}로 ${best.name}하세요.`
        : `${hand}의 ${topic(chosen.name)} ${pct(chosen.frequency)}뿐입니다. ` +
          `${subject(best.name)} ${pct(best.frequency)}로 주된 선택입니다.`,
  };
}

// ---------------------------------------------------------------------------
// 성적
// ---------------------------------------------------------------------------

export interface TrainerStats {
  answered: number;
  best: number;
  mixed: number;
  wrong: number;
  /** 지금 연속으로 맞힌 개수. */
  streak: number;
  bestStreak: number;
}

export const EMPTY_STATS: TrainerStats = {
  answered: 0,
  best: 0,
  mixed: 0,
  wrong: 0,
  streak: 0,
  bestStreak: 0,
};

export function applyResult(stats: TrainerStats, grade: Grade): TrainerStats {
  // 섞어 치는 쪽을 골랐어도 연속 기록은 이어준다. 해법에 있는 선택이기 때문이다.
  const continues = grade !== 'wrong';
  const streak = continues ? stats.streak + 1 : 0;

  return {
    answered: stats.answered + 1,
    best: stats.best + (grade === 'best' ? 1 : 0),
    mixed: stats.mixed + (grade === 'mixed' ? 1 : 0),
    wrong: stats.wrong + (grade === 'wrong' ? 1 : 0),
    streak,
    bestStreak: Math.max(stats.bestStreak, streak),
  };
}

/** 해법에 있는 선택을 고른 비율. 이게 실전에서 의미 있는 정확도다. */
export function accuracyOf(stats: TrainerStats): number {
  if (stats.answered === 0) return 0;
  return ((stats.best + stats.mixed) / stats.answered) * 100;
}

/** 문제를 사람이 읽는 상황 문장으로. */
export function questionTitle(question: TrainerQuestion): string {
  return scenarioTitle(question.scenario);
}

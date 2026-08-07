import { NUM_HANDS, handIndexToString, handShape } from '@holdem/poker-core';
import {
  POSITIONS_6MAX,
  POSITION_LABELS_KO,
  type PreflopConfig,
  type Position,
  type SpotActionNode,
  type SpotTree,
} from '@holdem/solver';
import { subject } from './korean';
import { getSpot, type PreflopData } from './preflop-data';

/**
 * "상황"을 만들고 그 상황에서의 답을 사람 말로 바꾸는 층.
 *
 * 여기가 이 프로젝트의 존재 이유다. 솔버 출력은 노드 인덱스와 확률 배열이지만,
 * 초보자에게 필요한 건 "당신은 버튼이고 앞이 다 죽었어요. 이 패는 레이즈하세요"다.
 */

export type Scenario =
  /** 앞에서 전부 폴드. 내가 처음 들어갈지 말지. */
  | { kind: 'open'; hero: Position }
  /** 앞사람이 오픈했고 내 차례. */
  | { kind: 'vs-open'; hero: Position; villain: Position }
  /** 내가 오픈했는데 뒤에서 3벳이 왔다. */
  | { kind: 'vs-3bet'; hero: Position; villain: Position }
  /** 내가 3벳했는데 4벳이 왔다. */
  | { kind: 'vs-4bet'; hero: Position; villain: Position };

export interface AdviceOption {
  kind: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  /** "레이즈" 같은 짧은 이름. */
  name: string;
  /** "2.5bb로 올리기" 같은 금액 포함 설명. */
  detail: string;
  frequency: number;
  amount: number;
}

export interface Advice {
  options: AdviceOption[];
  primary: AdviceOption;
  /** 두 갈래 이상을 실제로 섞어 치는 상황인가. */
  isMixed: boolean;
  /** 화면 맨 위에 크게 뜨는 한 줄. */
  headline: string;
  /** 그 밑에 붙는 부연. 섞어 치면 몇 번 중 몇 번인지 알려준다. */
  subline: string;
  /** 왜 그런지 한 문장. */
  reason: string;
  /**
   * 이 패로는 애초에 여기까지 올 일이 없는 경우.
   *
   * "UTG로 76s를 들고 오픈했는데 3벳을 맞았다"는 상황은 UTG가 76s를 오픈하지 않으니
   * 일어나지 않는다. 솔버도 그 가지를 학습할 이유가 없어서 균등 분포(33/33/33)를 남긴다.
   * 그걸 그대로 조언처럼 띄우면 초보자가 그대로 따라 하게 되므로 반드시 구분해야 한다.
   */
  unreachable: boolean;
}

// ---------------------------------------------------------------------------
// 상황 목록
// ---------------------------------------------------------------------------

export function listScenariosFor(hero: Position): Scenario[] {
  const out: Scenario[] = [];
  const heroIndex = POSITIONS_6MAX.indexOf(hero);

  if (hero !== 'BB') out.push({ kind: 'open', hero });

  // 내 앞자리들이 오픈한 경우
  for (let i = 0; i < heroIndex; i++) {
    out.push({ kind: 'vs-open', hero, villain: POSITIONS_6MAX[i]! });
  }

  // 내가 오픈했는데 뒷자리가 3벳한 경우
  if (hero !== 'BB') {
    for (let i = heroIndex + 1; i < POSITIONS_6MAX.length; i++) {
      out.push({ kind: 'vs-3bet', hero, villain: POSITIONS_6MAX[i]! });
    }
  }

  // 내가 3벳했는데 원래 오픈한 사람이 4벳한 경우
  for (let i = 0; i < heroIndex; i++) {
    out.push({ kind: 'vs-4bet', hero, villain: POSITIONS_6MAX[i]! });
  }

  return out;
}

export function scenarioId(scenario: Scenario): string {
  return 'villain' in scenario
    ? `${scenario.kind}:${scenario.hero}:${scenario.villain}`
    : `${scenario.kind}:${scenario.hero}`;
}

/**
 * 목록에 뜨는 짧은 이름.
 *
 * 포지션을 약어로만 쓰면(“CO가 레이즈”) 초보자는 CO가 어디인지 모른다.
 * 한글 이름을 앞에 붙여 약어를 자연스럽게 익히도록 한다.
 */
export function scenarioTitle(scenario: Scenario): string {
  const villainName = (position: Position) =>
    `${POSITION_LABELS_KO[position].full}(${position})`;

  switch (scenario.kind) {
    case 'open':
      return '앞사람 모두 폴드';
    case 'vs-open':
      return `${villainName(scenario.villain)}가 레이즈`;
    case 'vs-3bet':
      return `${villainName(scenario.villain)}가 재레이즈(3벳)`;
    case 'vs-4bet':
      return `${villainName(scenario.villain)}가 또 레이즈(4벳)`;
  }
}

/**
 * 상황을 문장으로 풀어쓴다. 화면 맨 위에 놓이는 문장이고,
 * 초보자가 "지금 무슨 일이 벌어지고 있는지" 이해하는 유일한 통로다.
 */
export function describeScenario(scenario: Scenario, config: PreflopConfig): string {
  const me = POSITION_LABELS_KO[scenario.hero];
  const blinds = config.smallBlind + config.bigBlind;
  const heroIndex = POSITIONS_6MAX.indexOf(scenario.hero);
  const behind = POSITIONS_6MAX.length - heroIndex - 1;

  switch (scenario.kind) {
    case 'open': {
      const size = config.openSize[scenario.hero];
      /*
       * UTG는 앞에 아무도 없다. "앞사람들이 모두 폴드했어요"라고 하면 틀린 말이고,
       * 초보자는 그 한 문장에서 포지션 개념을 잘못 잡는다.
       */
      const before =
        heroIndex === 0
          ? '이번 판에서 당신이 가장 먼저 행동합니다.'
          : `앞자리 ${heroIndex}명이 모두 폴드했어요.`;
      const after =
        behind > 0
          ? ` 뒤에는 아직 ${behind}명이 남아 있습니다.`
          : '';
      return (
        `당신은 ${me.full}(${scenario.hero})입니다. ${before}${after} ` +
        `지금 팟에는 블라인드 ${fmt(blinds)}bb가 놓여 있고, 들어가려면 ${fmt(size)}bb를 걸어야 합니다.`
      );
    }
    case 'vs-open': {
      const villain = POSITION_LABELS_KO[scenario.villain];
      const villainIndex = POSITIONS_6MAX.indexOf(scenario.villain);
      const size = config.openSize[scenario.villain];
      const owed = size - blindOf(scenario.hero, config);
      const villainName = `${villain.full}(${scenario.villain})`;

      // 오프너와 나 사이는 이미 접었지만, 내 뒤는 아직 차례가 오지 않았다.
      const between = heroIndex - villainIndex - 1;
      const betweenText = between > 0 ? ` 사이 ${between}명은 접었습니다.` : '';
      const behindText = behind > 0 ? ` 뒤에는 아직 ${behind}명이 남아 있습니다.` : '';

      return (
        `당신은 ${me.full}(${scenario.hero})입니다. ${subject(villainName)} ` +
        `${fmt(size)}bb로 레이즈했어요.${betweenText}${behindText} ` +
        `콜하려면 ${fmt(owed)}bb를 더 내면 됩니다.`
      );
    }
    case 'vs-3bet': {
      const villain = POSITION_LABELS_KO[scenario.villain];
      const open = config.openSize[scenario.hero];
      const villainName = `${villain.full}(${scenario.villain})`;
      // 3벳까지 오갔으면 나와 상대를 뺀 전원이 이미 답을 마쳤다.
      return (
        `당신은 ${me.full}(${scenario.hero})로 ${fmt(open)}bb 레이즈했습니다. ` +
        `그런데 ${subject(villainName)} 그 위에 다시 레이즈(3벳)했고 나머지는 모두 접었어요. ` +
        `이제 둘만 남았습니다 — 접을지, 받을지, 더 올릴지 정해야 합니다.`
      );
    }
    case 'vs-4bet': {
      const villain = POSITION_LABELS_KO[scenario.villain];
      return (
        `${villain.full}(${scenario.villain})의 레이즈에 당신이 ${me.full}(${scenario.hero})로 ` +
        `재레이즈(3벳)했는데, 상대가 또 올렸습니다(4벳). 나머지는 모두 접었어요. ` +
        `여기까지 왔다면 상대 레인지는 아주 강합니다.`
      );
    }
  }
}

/**
 * 상황마다 "왜 이 선택지밖에 없는지"를 알려주는 한 줄.
 *
 * 앞이 다 접힌 자리에서 콜 버튼이 없는 걸 보고 오류로 오해하기 쉽다.
 * 실제로 그 질문을 받았고, 화면이 설명하지 않은 게 문제였다.
 */
export function scenarioHint(scenario: Scenario, config: PreflopConfig): string | null {
  if (scenario.kind !== 'open') return null;

  if (scenario.hero === 'SB') {
    return (
      `스몰블라인드에는 "림프"라는 선택이 있습니다 — ${config.bigBlind}bb만 내고 들어가는 것이죠. ` +
      '0.5bb만 더 내면 되고 상대가 빅블라인드 하나뿐이라 값이 싸서, ' +
      '실제 해법에서도 자주 씁니다. 다른 자리는 뒤에 사람이 여럿이라 림프가 거의 없습니다.'
    );
  }

  return (
    '여기서 "콜"이 없는 건 맞출 금액이 없기 때문입니다 — 앞사람이 다 접었으니까요. ' +
    `${config.bigBlind}bb만 내고 살짝 들어가는 걸 림프라고 부르는데, ` +
    '뒤에 사람이 남은 자리에서는 실제 해법에서도 거의 쓰지 않습니다. ' +
    '열려면 제대로 열고, 아니면 접는 게 맞습니다.'
  );
}

function blindOf(position: Position, config: PreflopConfig): number {
  if (position === 'SB') return config.smallBlind;
  if (position === 'BB') return config.bigBlind;
  return 0;
}

// ---------------------------------------------------------------------------
// 조언 생성
// ---------------------------------------------------------------------------

export function getAdvice(
  data: PreflopData,
  scenario: Scenario,
  handIndex: number,
): Advice | null {
  const options = collectOptions(data, scenario, handIndex);
  if (!options || options.length === 0) return null;

  const sorted = [...options].sort((a, b) => b.frequency - a.frequency);
  const primary = sorted[0]!;
  const meaningful = sorted.filter((o) => o.frequency >= 0.08);
  const isMixed = meaningful.length > 1;
  const unreachable = isUnreachable(data, scenario, handIndex);

  if (unreachable) {
    return {
      options: sorted,
      primary,
      isMixed: false,
      unreachable: true,
      headline: '이 상황은 나오지 않습니다',
      subline: unreachableSubline(scenario, handIndex),
      reason:
        '앞 단계에서 이미 접는 패라 여기까지 올 일이 없습니다. ' +
        '솔버도 일어나지 않는 상황은 계산하지 않으므로, 아래 숫자는 의미가 없습니다.',
    };
  }

  return {
    options: sorted,
    primary,
    isMixed,
    unreachable: false,
    headline: headlineFor(primary, isMixed),
    subline: sublineFor(sorted, isMixed),
    reason: reasonFor(data, scenario, handIndex, sorted, isMixed),
  };
}

/** 이 패로 이 상황까지 오려면 앞 단계에서 그 액션을 했어야 한다. 안 하는 패면 도달 불가. */
const REACH_THRESHOLD = 0.02;

function isUnreachable(data: PreflopData, scenario: Scenario, handIndex: number): boolean {
  if (scenario.kind === 'open' || scenario.kind === 'vs-open') return false;

  if (scenario.kind === 'vs-3bet') {
    // 3벳을 맞으려면 내가 먼저 오픈했어야 한다.
    return (data.openFrequency[scenario.hero][handIndex] ?? 0) < REACH_THRESHOLD;
  }

  // vs-4bet: 4벳을 맞으려면 내가 3벳을 했어야 한다.
  const spot = getSpot(data, scenario.villain, scenario.hero);
  const root = asAction(spot.tree, spot.tree.root);
  if (!root) return true;
  const raiseIndex = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
  if (raiseIndex < 0) return true;
  const threeBetFreq = spot.strategy[root.offset + raiseIndex * NUM_HANDS + handIndex] ?? 0;
  return threeBetFreq < REACH_THRESHOLD;
}

function unreachableSubline(scenario: Scenario, handIndex: number): string {
  const hand = handIndexToString(handIndex);
  if (scenario.kind === 'vs-3bet') {
    return `${scenario.hero}에서 ${hand}는 애초에 오픈하지 않는 패라, 3벳을 맞을 일 자체가 없습니다.`;
  }
  return `${hand}로는 3벳을 하지 않으니, 4벳을 맞을 일이 없습니다.`;
}

function collectOptions(
  data: PreflopData,
  scenario: Scenario,
  handIndex: number,
): AdviceOption[] | null {
  const config = data.config;

  if (scenario.kind === 'open') {
    const raiseFreq = data.openFrequency[scenario.hero][handIndex] ?? 0;
    const size = config.openSize[scenario.hero];

    /**
     * 스몰블라인드에는 림프가 있다.
     *
     * SB는 0.5bb만 더 내면 플롭을 보므로 값이 워낙 싸고, 상대가 BB 하나뿐이라
     * 실제 해법에도 유의미한 빈도로 존재한다. 다른 자리는 뒤에 사람이 여럿이라
     * 거의 0이어서 트리에서 뺐다.
     */
    const limpFreq = scenario.hero === 'SB' ? (data.limpFrequency[handIndex] ?? 0) : 0;

    const options: AdviceOption[] = [
      {
        kind: 'raise',
        name: '레이즈',
        detail: `${fmt(size)}bb로 올리기`,
        frequency: raiseFreq,
        amount: size,
      },
    ];

    if (limpFreq > 0.005) {
      options.push({
        kind: 'call',
        name: '림프',
        detail: `${fmt(config.bigBlind)}bb만 내고 들어가기`,
        frequency: limpFreq,
        amount: config.bigBlind,
      });
    }

    options.push({
      kind: 'fold',
      name: '폴드',
      detail: '이번 판은 접기',
      frequency: Math.max(0, 1 - raiseFreq - limpFreq),
      amount: 0,
    });

    return options;
  }

  const node = findNode(data, scenario);
  if (!node) return null;
  const spot = getSpot(
    data,
    scenario.kind === 'vs-open' || scenario.kind === 'vs-4bet' ? scenario.villain : scenario.hero,
    scenario.kind === 'vs-open' || scenario.kind === 'vs-4bet' ? scenario.hero : scenario.villain,
  );

  return node.actions.map((action, index) => ({
    kind: action.kind,
    name: friendlyName(action.kind),
    detail: friendlyDetail(action.kind, action.to),
    frequency: spot.strategy[node.offset + index * NUM_HANDS + handIndex] ?? 0,
    amount: action.to,
  }));
}

/** 시나리오가 가리키는 트리 노드를 찾는다. */
function findNode(data: PreflopData, scenario: Scenario): SpotActionNode | null {
  switch (scenario.kind) {
    case 'open':
      return null;

    case 'vs-open': {
      // villain이 오픈했고 hero가 대응한다 → 스팟의 루트가 바로 그 자리
      const spot = getSpot(data, scenario.villain, scenario.hero);
      return asAction(spot.tree, spot.tree.root);
    }

    case 'vs-3bet': {
      // hero가 오픈했고 villain이 3벳했다 → 루트(villain)에서 레이즈 갈래의 자식
      const spot = getSpot(data, scenario.hero, scenario.villain);
      const root = asAction(spot.tree, spot.tree.root);
      if (!root) return null;
      const raiseIndex = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
      if (raiseIndex < 0) return null;
      return asAction(spot.tree, root.children[raiseIndex]!);
    }

    case 'vs-4bet': {
      // villain이 오픈, hero가 3벳, villain이 4벳 → 세 단계 내려간 자리
      const spot = getSpot(data, scenario.villain, scenario.hero);
      const root = asAction(spot.tree, spot.tree.root);
      if (!root) return null;
      const threeBet = root.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
      if (threeBet < 0) return null;
      const openerNode = asAction(spot.tree, root.children[threeBet]!);
      if (!openerNode) return null;
      const fourBet = openerNode.actions.findIndex((a) => a.kind === 'raise' || a.kind === 'allin');
      if (fourBet < 0) return null;
      return asAction(spot.tree, openerNode.children[fourBet]!);
    }
  }
}

function asAction(tree: SpotTree, index: number): SpotActionNode | null {
  const node = tree.nodes[index];
  return node && node.kind === 'action' ? node : null;
}

function friendlyName(kind: AdviceOption['kind']): string {
  switch (kind) {
    case 'fold':
      return '폴드';
    case 'check':
      return '체크';
    case 'call':
      return '콜';
    case 'raise':
      return '레이즈';
    case 'allin':
      return '올인';
  }
}

function friendlyDetail(kind: AdviceOption['kind'], to: number): string {
  switch (kind) {
    case 'fold':
      return '이번 판은 접기';
    case 'check':
      return '돈 안 걸고 넘기기';
    case 'call':
      return `${fmt(to)}bb까지 맞춰 받기`;
    case 'raise':
      return `${fmt(to)}bb로 올리기`;
    case 'allin':
      return `가진 칩 전부(${fmt(to)}bb) 걸기`;
  }
}

function headlineFor(primary: AdviceOption, isMixed: boolean): string {
  const verb: Record<AdviceOption['kind'], string> = {
    fold: '폴드하세요',
    check: '체크하세요',
    call: '콜하세요',
    raise: '레이즈하세요',
    allin: '올인하세요',
  };
  if (!isMixed) return verb[primary.kind];
  return `주로 ${verb[primary.kind].replace('하세요', '')}`;
}

function sublineFor(options: AdviceOption[], isMixed: boolean): string {
  if (!isMixed) {
    const primary = options[0]!;
    return `이 패는 항상 ${primary.name}입니다. ${primary.detail}.`;
  }
  const parts = options
    .filter((o) => o.frequency >= 0.08)
    .map((o) => `${o.name} ${Math.round(o.frequency * 100)}%`);
  return `섞어 치는 패입니다 — ${parts.join(' · ')}. 10번 중 ${Math.round(options[0]!.frequency * 10)}번쯤 ${options[0]!.name}하면 됩니다.`;
}

/**
 * "왜 그런가"를 한 문장으로.
 *
 * 솔버는 이유를 말해주지 않는다. 그래서 결과와 상황을 보고 사람이 납득할 만한
 * 설명을 규칙으로 만든다. 정확한 인과는 아니지만, 초보자가 패턴을 익히는 데는
 * 숫자만 던지는 것보다 훨씬 낫다.
 */
function reasonFor(
  data: PreflopData,
  scenario: Scenario,
  handIndex: number,
  options: AdviceOption[],
  isMixed: boolean,
): string {
  const hand = handIndexToString(handIndex);
  const shape = handShape(handIndex);
  const primary = options[0]!;
  const positionHint = POSITION_LABELS_KO[scenario.hero].hint;

  if (isMixed) {
    return `${hand}는 이 상황에서 딱 경계선에 있는 패입니다. 한쪽으로만 치면 상대가 읽기 쉬워지기 때문에 섞습니다.`;
  }

  if (scenario.kind === 'open') {
    if (primary.kind === 'raise') {
      const pct = rangeShare(data.openFrequency[scenario.hero]);
      return `${scenario.hero}에서는 전체 패의 약 ${pct.toFixed(0)}%를 오픈합니다. ${hand}는 그 안에 넉넉히 들어갑니다. ${positionHint}`;
    }
    return `${hand}로는 이 자리에서 이익을 내기 어렵습니다. ${positionHint}`;
  }

  if (primary.kind === 'fold') {
    return `상대가 이 정도로 올렸다면 강한 패 위주입니다. ${hand}로 계속 가면 손해가 쌓입니다.`;
  }
  if (primary.kind === 'call') {
    return shape === 'pair'
      ? `${hand}는 플롭에서 셋을 맞출 가능성 때문에 값을 치를 만합니다.`
      : `${hand}는 올리기엔 애매하지만 접기엔 아까운 구간이라 일단 받습니다.`;
  }
  if (primary.kind === 'raise' || primary.kind === 'allin') {
    return `${hand}는 상대의 강한 레인지를 상대로도 앞서는 부류라 값을 키웁니다.`;
  }
  return positionHint;
}

function rangeShare(frequency: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    const text = handIndexToString(h);
    const count = text.length === 2 ? 6 : text.endsWith('s') ? 4 : 12;
    combos += frequency[h]! * count;
  }
  return (combos / 1326) * 100;
}

/** 매트릭스 뷰가 쓰는 169칸 빈도. 시나리오별 주 액션 기준. */
export function frequencyGrid(
  data: PreflopData,
  scenario: Scenario,
  actionKind: AdviceOption['kind'],
): Float32Array {
  const out = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    const advice = getAdvice(data, scenario, h);
    if (!advice || advice.unreachable) continue;
    const option = advice.options.find((o) => o.kind === actionKind);
    out[h] = option ? option.frequency : 0;
  }
  return out;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

import { POSITIONS_6MAX, type PreflopConfig, type Position } from './config';

/**
 * 프리플롭 액션을 사람이 하나씩 쌓아 만드는 상태 머신.
 *
 * 목록에서 고르는 방식으로는 "UTG가 3bb 열고 CO가 12bb로 3벳" 같은 걸 넣을 수 없다.
 * 실제로 친 판을 그대로 재현하려면 누가 무엇을 얼마에 했는지를 순서대로 받아야 한다.
 *
 * 규칙은 트리 빌더와 같지만, 이쪽은 **사람이 임의로 넣는 값**을 받으므로
 * 유효성 검사와 되돌리기가 필요하다. 그래서 별도로 둔다.
 */

export type SequenceActionKind = 'fold' | 'check' | 'call' | 'raise';

export interface SequenceAction {
  position: Position;
  kind: SequenceActionKind;
  /** raise일 때 "총 얼마까지 올렸는가"(bb). fold/check/call은 그 시점 콜 금액. */
  to: number;
}

export interface SequenceState {
  config: PreflopConfig;
  actions: SequenceAction[];
  invested: number[];
  folded: boolean[];
  acted: boolean[];
  allIn: boolean[];
  /** 지금 행동할 사람. null이면 베팅이 끝났다. */
  toAct: number | null;
  currentBet: number;
  raiseCount: number;
  lastRaiseTo: number;
}

export type SequenceOutcome =
  /** 아직 행동할 사람이 남았다. */
  | { kind: 'ongoing'; toAct: Position }
  /** 한 명 빼고 다 접었다. 카드를 보지 않고 끝난다. */
  | { kind: 'walkover'; winner: Position; pot: number }
  /** 둘이 플롭을 본다. 우리가 풀 수 있는 유일한 경우. */
  | { kind: 'heads-up'; players: [Position, Position]; pot: number; effectiveStack: number }
  /** 셋 이상이 플롭을 본다. 지금 엔진으로는 풀 수 없다. */
  | { kind: 'multiway'; players: Position[]; pot: number };

export function initialSequence(config: PreflopConfig): SequenceState {
  const n = config.playerCount;
  const invested = new Array<number>(n).fill(config.ante);
  const sb = POSITIONS_6MAX.indexOf('SB');
  const bb = POSITIONS_6MAX.indexOf('BB');
  invested[sb] += config.smallBlind;
  invested[bb] += config.bigBlind;

  return {
    config,
    actions: [],
    invested,
    folded: new Array<boolean>(n).fill(false),
    acted: new Array<boolean>(n).fill(false),
    allIn: new Array<boolean>(n).fill(false),
    toAct: 0, // UTG부터
    currentBet: config.bigBlind + config.ante,
    raiseCount: 0,
    lastRaiseTo: config.bigBlind,
  };
}

export interface LegalAction {
  kind: SequenceActionKind;
  /** 이 액션을 고르면 도달하는 총 투자액. */
  to: number;
  label: string;
  /** 레이즈의 경우 사용자가 금액을 바꿀 수 있다. */
  adjustable: boolean;
  /** 레이즈로 넣을 수 있는 최소·최대 금액. */
  min?: number;
  max?: number;
}

export function legalActions(state: SequenceState): LegalAction[] {
  if (state.toAct === null) return [];
  const player = state.toAct;
  const { config } = state;
  const owed = state.currentBet - state.invested[player]!;
  const remaining = config.stack - state.invested[player]!;
  if (remaining <= 0) return [];

  const out: LegalAction[] = [];

  if (owed > 0) {
    out.push({ kind: 'fold', to: state.invested[player]!, label: '폴드', adjustable: false });
    const callTo = Math.min(state.currentBet, config.stack);
    out.push({
      kind: 'call',
      to: callTo,
      label: owed >= remaining ? '콜 (올인)' : `콜 ${fmt(callTo)}bb`,
      adjustable: false,
    });
  } else {
    out.push({ kind: 'check', to: state.invested[player]!, label: '체크', adjustable: false });
  }

  if (state.raiseCount < 4) {
    const suggested = suggestRaise(state, player);
    const min = minRaiseTo(state);
    if (min <= config.stack) {
      out.push({
        kind: 'raise',
        to: Math.max(min, Math.min(suggested, config.stack)),
        label: raiseLabel(state.raiseCount),
        adjustable: true,
        min,
        max: config.stack,
      });
    }
  }

  return out;
}

/** 최소 레이즈: 직전 레이즈 폭만큼 더 올려야 한다. */
function minRaiseTo(state: SequenceState): number {
  const increment = Math.max(state.currentBet - state.lastRaiseTo, state.config.bigBlind);
  return state.currentBet + increment;
}

/** 설정값에서 나온 "보통 이 정도" 금액. 사용자가 그대로 써도 되고 고쳐도 된다. */
function suggestRaise(state: SequenceState, player: number): number {
  const { config } = state;
  const position = POSITIONS_6MAX[player]!;
  if (state.raiseCount === 0) {
    const base = config.openSize[position];
    return base > 0 ? base : config.bigBlind * 3;
  }
  if (state.raiseCount === 1) return round(state.lastRaiseTo * config.threeBetMultiplierIP);
  if (state.raiseCount === 2) return round(state.lastRaiseTo * config.fourBetMultiplier);
  return config.stack;
}

export function applyAction(
  state: SequenceState,
  kind: SequenceActionKind,
  to?: number,
): SequenceState {
  if (state.toAct === null) throw new Error('이미 베팅이 끝났습니다');
  const player = state.toAct;
  const { config } = state;

  const next: SequenceState = {
    ...state,
    invested: [...state.invested],
    folded: [...state.folded],
    acted: [...state.acted],
    allIn: [...state.allIn],
    actions: [...state.actions],
  };
  next.acted[player] = true;

  let resolvedTo = state.invested[player]!;

  switch (kind) {
    case 'fold':
      next.folded[player] = true;
      break;
    case 'check':
      break;
    case 'call':
      resolvedTo = Math.min(state.currentBet, config.stack);
      next.invested[player] = resolvedTo;
      if (resolvedTo >= config.stack) next.allIn[player] = true;
      break;
    case 'raise': {
      const target = to ?? minRaiseTo(state);
      const clamped = Math.min(Math.max(target, minRaiseTo(state)), config.stack);
      resolvedTo = clamped;
      next.invested[player] = clamped;
      next.currentBet = clamped;
      next.lastRaiseTo = clamped;
      next.raiseCount = state.raiseCount + 1;
      if (clamped >= config.stack) next.allIn[player] = true;
      // 레이즈가 나오면 나머지는 다시 답해야 한다.
      for (let p = 0; p < config.playerCount; p++) {
        if (p !== player && !next.folded[p] && !next.allIn[p]) next.acted[p] = false;
      }
      break;
    }
  }

  next.actions.push({ position: POSITIONS_6MAX[player]!, kind, to: resolvedTo });
  next.toAct = nextToAct(next, player);
  return next;
}

/** 마지막 액션 하나를 되돌린다. 처음부터 다시 쌓아 만든다. */
export function undoLast(state: SequenceState): SequenceState {
  if (state.actions.length === 0) return state;
  const replay = state.actions.slice(0, -1);
  let rebuilt = initialSequence(state.config);
  for (const action of replay) {
    rebuilt = applyAction(rebuilt, action.kind, action.to);
  }
  return rebuilt;
}

/** 방금 행동한 사람 다음부터 시계 방향으로, 아직 답하지 않은 첫 사람을 찾는다. */
function nextToAct(state: SequenceState, from: number): number | null {
  const n = state.config.playerCount;
  if (countWhere(state.folded, false) <= 1) return null;

  for (let step = 1; step <= n; step++) {
    const p = (from + step) % n;
    if (state.folded[p] || state.allIn[p]) continue;
    // 아직 한 번도 안 했거나, 레이즈를 맞아 금액을 못 맞춘 사람.
    if (!state.acted[p] || state.invested[p]! < state.currentBet) return p;
  }
  return null;
}

export function outcomeOf(state: SequenceState): SequenceOutcome {
  const alive: number[] = [];
  for (let p = 0; p < state.config.playerCount; p++) if (!state.folded[p]) alive.push(p);
  const pot = state.invested.reduce((a, b) => a + b, 0);

  if (alive.length <= 1) {
    return { kind: 'walkover', winner: POSITIONS_6MAX[alive[0] ?? 0]!, pot };
  }
  if (state.toAct !== null) {
    return { kind: 'ongoing', toAct: POSITIONS_6MAX[state.toAct]! };
  }

  const players = alive.map((p) => POSITIONS_6MAX[p]!);
  if (alive.length === 2) {
    // 서로 맞춘 금액만 팟에 남고 초과분은 돌려받는다.
    const matched = Math.min(state.invested[alive[0]!]!, state.invested[alive[1]!]!);
    const dead = state.invested.reduce(
      (sum, value, index) => (alive.includes(index) ? sum : sum + value),
      0,
    );
    return {
      kind: 'heads-up',
      players: [players[0]!, players[1]!],
      pot: matched * 2 + dead,
      effectiveStack: state.config.stack - matched,
    };
  }
  return { kind: 'multiway', players, pot };
}

/** 사람이 읽는 요약. "UTG 2.5bb 레이즈 → CO 7.5bb 3벳 → UTG 콜" */
export function describeSequence(state: SequenceState): string {
  if (state.actions.length === 0) return '아직 아무 일도 없었습니다';
  return state.actions
    .filter((action) => action.kind !== 'fold')
    .map((action) => `${action.position} ${labelOf(action)}`)
    .join(' → ');
}

function labelOf(action: SequenceAction): string {
  switch (action.kind) {
    case 'fold':
      return '폴드';
    case 'check':
      return '체크';
    case 'call':
      return `콜 ${fmt(action.to)}bb`;
    case 'raise':
      return `${fmt(action.to)}bb 레이즈`;
  }
}

function raiseLabel(raiseCount: number): string {
  return ['레이즈(오픈)', '3벳', '4벳', '5벳'][raiseCount] ?? '레이즈';
}

function countWhere(flags: readonly boolean[], value: boolean): number {
  let count = 0;
  for (const flag of flags) if (flag === value) count++;
  return count;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function round(x: number): number {
  return Math.round(x * 2) / 2;
}

import { POSITIONS_6MAX, type PreflopConfig, type Position } from './config';

/**
 * 프리플롭 액션 트리.
 *
 * 노드는 배열에 평평하게 담고 자식은 인덱스로 가리킨다. 객체 그래프로 만들면
 * CFR 재귀가 포인터 추적으로 느려지고, 나중에 Worker로 넘길 때 직렬화도 번거롭다.
 */

export type ActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PreflopAction {
  kind: ActionKind;
  /** raise/allin일 때 "총 얼마까지 올리는가"(bb). fold/check/call은 0. */
  to: number;
  /** 화면에 그대로 띄우는 한국어 라벨. */
  label: string;
}

export type TerminalKind =
  /** 한 명 빼고 다 폴드. 카드를 보지 않고 팟이 결정된다. */
  | 'uncontested'
  /** 올인 대치. 보드를 끝까지 깔고 에퀴티로 나눈다. */
  | 'allin-showdown'
  /** 프리플롭 베팅 종료, 스택이 남아 플롭으로 간다. */
  | 'postflop';

export interface ActionNode {
  kind: 'action';
  index: number;
  /** 이 노드에서 행동할 플레이어(포지션 인덱스). */
  player: number;
  actions: PreflopAction[];
  children: number[];
  /** 각 플레이어가 지금까지 넣은 금액. */
  invested: number[];
  pot: number;
  /** 아직 폴드하지 않은 플레이어 인덱스. */
  active: number[];
  /** 오픈=1, 3벳=2, 4벳=3, 5벳=4. */
  raiseCount: number;
  /** 전략/리그렛 배열에서 이 노드가 차지하는 시작 위치. */
  offset: number;
}

export interface TerminalNode {
  kind: 'terminal';
  index: number;
  terminal: TerminalKind;
  invested: number[];
  pot: number;
  /** 쇼다운/플롭으로 가는 플레이어들. uncontested면 승자 1명. */
  contenders: number[];
}

export type TreeNode = ActionNode | TerminalNode;

export interface PreflopTree {
  nodes: TreeNode[];
  root: number;
  config: PreflopConfig;
  /** 전략/리그렛 배열의 총 길이 = Σ(노드별 액션 수 × 169). */
  strategySize: number;
  actionNodeCount: number;
  terminalNodeCount: number;
}

const NUM_HANDS = 169;

interface BuildState {
  invested: number[];
  folded: boolean[];
  allIn: boolean[];
  /** 이번 베팅 라운드에서 행동한 적이 있는가. */
  acted: boolean[];
  toAct: number;
  currentBet: number;
  raiseCount: number;
  /** 마지막으로 레이즈한 총액. 다음 레이즈 사이즈 계산에 쓴다. */
  lastRaiseTo: number;
}

export function buildPreflopTree(config: PreflopConfig): PreflopTree {
  const n = config.playerCount;
  const nodes: TreeNode[] = [];
  let strategySize = 0;

  const invested = new Array<number>(n).fill(config.ante);
  const sbIndex = POSITIONS_6MAX.indexOf('SB');
  const bbIndex = POSITIONS_6MAX.indexOf('BB');
  invested[sbIndex] += config.smallBlind;
  invested[bbIndex] += config.bigBlind;

  const initial: BuildState = {
    invested,
    folded: new Array<boolean>(n).fill(false),
    allIn: new Array<boolean>(n).fill(false),
    acted: new Array<boolean>(n).fill(false),
    toAct: 0, // UTG부터
    currentBet: config.bigBlind + config.ante,
    raiseCount: 0,
    lastRaiseTo: config.bigBlind,
  };

  const root = build(initial);

  return {
    nodes,
    root,
    config,
    strategySize,
    actionNodeCount: nodes.filter((x) => x.kind === 'action').length,
    terminalNodeCount: nodes.filter((x) => x.kind === 'terminal').length,
  };

  function build(state: BuildState): number {
    const stillIn = indicesWhere(state.folded, false);

    // 한 명만 남으면 카드를 볼 필요가 없다.
    if (stillIn.length === 1) {
      return pushTerminal('uncontested', state, stillIn);
    }

    if (isBettingRoundOver(state)) {
      const canStillBet = stillIn.filter((p) => !state.allIn[p]);
      // 액션 가능한 사람이 1명 이하이고 누군가 올인이면 대치 상황이다.
      const anyAllIn = stillIn.some((p) => state.allIn[p]);
      if (anyAllIn && canStillBet.length <= 1) {
        return pushTerminal('allin-showdown', state, stillIn);
      }
      return pushTerminal('postflop', state, stillIn);
    }

    const player = state.toAct;
    const actions = legalActions(state, player);
    const node: ActionNode = {
      kind: 'action',
      index: nodes.length,
      player,
      actions,
      children: [],
      invested: [...state.invested],
      pot: sum(state.invested),
      active: stillIn,
      raiseCount: state.raiseCount,
      offset: strategySize,
    };
    nodes.push(node);
    strategySize += actions.length * NUM_HANDS;

    for (const action of actions) {
      node.children.push(build(applyAction(state, player, action)));
    }
    return node.index;
  }

  function pushTerminal(
    terminal: TerminalKind,
    state: BuildState,
    contenders: number[],
  ): number {
    const node: TerminalNode = {
      kind: 'terminal',
      index: nodes.length,
      terminal,
      invested: [...state.invested],
      pot: sum(state.invested),
      contenders,
    };
    nodes.push(node);
    return node.index;
  }

  function isBettingRoundOver(state: BuildState): boolean {
    for (let p = 0; p < n; p++) {
      if (state.folded[p] || state.allIn[p]) continue;
      if (!state.acted[p]) return false;
      if (state.invested[p]! < state.currentBet) return false;
    }
    return true;
  }

  function legalActions(state: BuildState, player: number): PreflopAction[] {
    const out: PreflopAction[] = [];
    const owed = state.currentBet - state.invested[player]!;
    const stack = config.stack;
    const remaining = stack - state.invested[player]!;

    if (owed > 0) {
      out.push({ kind: 'fold', to: 0, label: '폴드' });
    } else {
      out.push({ kind: 'check', to: 0, label: '체크' });
    }

    // 아무도 레이즈하지 않았는데 콜하는 것 = 림프. 기본값은 금지다 (config 주석 참고).
    const isLimp = state.raiseCount === 0;
    if (owed > 0 && (!isLimp || config.allowLimp)) {
      if (owed < remaining) {
        out.push({ kind: 'call', to: state.currentBet, label: `콜 ${fmt(state.currentBet)}bb` });
      } else {
        // 콜하면 자동으로 올인이 되는 상황
        out.push({ kind: 'call', to: stack, label: '콜 올인' });
      }
    }

    const raiseTo = nextRaiseSize(state, player);
    if (raiseTo !== null && raiseTo > state.currentBet && remaining > 0) {
      if (raiseTo >= stack * config.allInThreshold) {
        out.push({ kind: 'allin', to: stack, label: `올인 ${fmt(stack)}bb` });
      } else {
        out.push({ kind: 'raise', to: raiseTo, label: raiseLabel(state.raiseCount, raiseTo) });
      }
    }

    return out;
  }

  /**
   * 다음 레이즈를 얼마로 할지. 고정 사이징이라 노드마다 선택지가 하나뿐이고,
   * 그래서 트리가 폭발하지 않는다. 사이즈를 늘리고 싶으면 여기서 배열을 반환하도록
   * 바꾸면 되지만 노드 수가 곱으로 늘어난다는 점을 감안해야 한다.
   */
  function nextRaiseSize(state: BuildState, player: number): number | null {
    if (state.raiseCount >= 4) return null; // 5벳 위로는 올리지 않는다
    const stack = config.stack;
    const position = POSITIONS_6MAX[player] as Position;

    if (state.raiseCount === 0) {
      // 오픈. 앞에 림퍼가 있으면 그 수만큼 키운다.
      const limpers = countLimpers(state);
      const base = config.openSize[position];
      if (base <= 0) return null; // BB는 오픈이라는 개념이 없다 (레이즈로 취급)
      return round(base + limpers * config.bigBlind);
    }

    if (state.raiseCount === 1) {
      // 3벳. 오픈한 사람보다 뒤에서 하면 IP, 앞이면 OOP.
      const openerIdx = lastAggressor(state);
      const ip = openerIdx !== null && isPostflopIP(player, openerIdx);
      const mult = ip ? config.threeBetMultiplierIP : config.threeBetMultiplierOOP;
      const callers = countCallersSince(state);
      const extra = callers * config.squeezeExtraPerCaller * state.lastRaiseTo;
      return Math.min(round(state.lastRaiseTo * mult + extra), stack);
    }

    if (state.raiseCount === 2) {
      return Math.min(round(state.lastRaiseTo * config.fourBetMultiplier), stack);
    }

    // 5벳은 항상 올인
    return stack;
  }

  function countLimpers(state: BuildState): number {
    let count = 0;
    for (let p = 0; p < n; p++) {
      if (state.folded[p]) continue;
      if (!state.acted[p]) continue;
      if (state.invested[p] === config.bigBlind + config.ante && p !== bbIndex) count++;
    }
    return count;
  }

  function countCallersSince(state: BuildState): number {
    let count = 0;
    for (let p = 0; p < n; p++) {
      if (state.folded[p] || !state.acted[p]) continue;
      if (state.invested[p] === state.currentBet && state.invested[p]! > config.bigBlind) count++;
    }
    return Math.max(0, count - 1); // 마지막 레이저 본인 제외
  }

  function lastAggressor(state: BuildState): number | null {
    let best: number | null = null;
    for (let p = 0; p < n; p++) {
      if (state.folded[p]) continue;
      if (state.invested[p] === state.lastRaiseTo) best = p;
    }
    return best;
  }

  function applyAction(state: BuildState, player: number, action: PreflopAction): BuildState {
    const next: BuildState = {
      invested: [...state.invested],
      folded: [...state.folded],
      allIn: [...state.allIn],
      acted: [...state.acted],
      toAct: state.toAct,
      currentBet: state.currentBet,
      raiseCount: state.raiseCount,
      lastRaiseTo: state.lastRaiseTo,
    };
    next.acted[player] = true;

    switch (action.kind) {
      case 'fold':
        next.folded[player] = true;
        break;
      case 'check':
        break;
      case 'call':
        next.invested[player] = Math.min(action.to, config.stack);
        if (next.invested[player] >= config.stack) next.allIn[player] = true;
        break;
      case 'raise':
      case 'allin': {
        next.invested[player] = action.to;
        next.currentBet = action.to;
        next.lastRaiseTo = action.to;
        next.raiseCount = state.raiseCount + 1;
        if (action.to >= config.stack) next.allIn[player] = true;
        // 레이즈가 나오면 나머지는 다시 행동해야 한다.
        for (let p = 0; p < n; p++) {
          if (p !== player && !next.folded[p] && !next.allIn[p]) next.acted[p] = false;
        }
        break;
      }
    }

    next.toAct = nextToAct(next, player);
    return next;
  }

  function nextToAct(state: BuildState, from: number): number {
    for (let step = 1; step <= n; step++) {
      const p = (from + step) % n;
      if (!state.folded[p] && !state.allIn[p]) return p;
    }
    return from;
  }

  function isPostflopIP(hero: number, villain: number): boolean {
    // 플롭 이후 순서는 SB → BB → UTG → ... → BTN. 인덱스가 클수록 나중에 행동한다.
    const order = (idx: number) => (idx >= sbIndex ? idx - sbIndex : idx - sbIndex + n);
    return order(hero) > order(villain);
  }
}

function raiseLabel(raiseCount: number, to: number): string {
  const names = ['오픈 레이즈', '3벳', '4벳', '5벳'];
  return `${names[raiseCount] ?? '레이즈'} ${fmt(to)}bb`;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function round(x: number): number {
  return Math.round(x * 2) / 2; // 0.5bb 단위로 맞춘다
}

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function indicesWhere(flags: readonly boolean[], value: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < flags.length; i++) if (flags[i] === value) out.push(i);
  return out;
}

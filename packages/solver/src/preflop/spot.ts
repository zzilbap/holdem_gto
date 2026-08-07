import { isInPosition, type PreflopConfig, type Position } from './config';

/**
 * 스팟 = 두 명만 남은 프리플롭 상황 하나.
 *
 * "BTN이 2.5bb 오픈했고 내가 BB, 팟에 0.5bb 데드머니" 같은 것.
 * 폴드한 사람들은 사라지고 그들이 남긴 돈만 `deadMoney`로 남는다.
 *
 * 6인 전체 트리 대신 이 단위로 푸는 이유는 ARCHITECTURE.md 참고.
 */

export interface SpotDefinition {
  /** 먼저 행동하는 쪽. */
  first: Position;
  /** 나중에 행동하는 쪽. */
  second: Position;
  /** 이미 죽은 사람들이 팟에 두고 간 돈(bb). */
  deadMoney: number;
  /** [first, second]가 지금까지 넣은 금액. */
  invested: [number, number];
  /** 지금까지 나온 레이즈 횟수. 오픈=1, 3벳=2, 4벳=3. 다음 사이즈를 이걸로 정한다. */
  raiseCount: number;
  /** 사람이 읽을 상황 설명. UI가 그대로 쓴다. */
  label: string;
}

export type SpotActionKind = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface SpotAction {
  kind: SpotActionKind;
  to: number;
  label: string;
}

export interface SpotActionNode {
  kind: 'action';
  index: number;
  /** 0 = first, 1 = second */
  player: 0 | 1;
  actions: SpotAction[];
  children: number[];
  invested: [number, number];
  offset: number;
}

export type SpotTerminalKind = 'fold' | 'allin-showdown' | 'postflop';

export interface SpotTerminalNode {
  kind: 'terminal';
  index: number;
  terminal: SpotTerminalKind;
  invested: [number, number];
  pot: number;
  /** terminal이 'fold'일 때 이긴 쪽. */
  winner?: 0 | 1;
}

export type SpotNode = SpotActionNode | SpotTerminalNode;

export interface SpotTree {
  nodes: SpotNode[];
  root: number;
  definition: SpotDefinition;
  config: PreflopConfig;
  /** 각 플레이어가 몇 번째 자리인지 → 포지션 */
  positions: [Position, Position];
  strategySize: number;
}

const NUM_HANDS = 169;

interface SpotState {
  invested: [number, number];
  acted: [boolean, boolean];
  allIn: [boolean, boolean];
  toAct: 0 | 1;
  currentBet: number;
  raiseCount: number;
  lastRaiseTo: number;
}

export function buildSpotTree(definition: SpotDefinition, config: PreflopConfig): SpotTree {
  const nodes: SpotNode[] = [];
  let strategySize = 0;
  const positions: [Position, Position] = [definition.first, definition.second];

  const initial: SpotState = {
    invested: [...definition.invested],
    acted: [false, false],
    allIn: [
      definition.invested[0] >= config.stack,
      definition.invested[1] >= config.stack,
    ],
    toAct: 0,
    currentBet: Math.max(definition.invested[0], definition.invested[1]),
    raiseCount: definition.raiseCount,
    lastRaiseTo: Math.max(definition.invested[0], definition.invested[1]),
  };

  const root = build(initial);

  return { nodes, root, definition, config, positions, strategySize };

  function build(state: SpotState): number {
    if (isRoundOver(state)) {
      const bothAllIn = state.allIn[0] || state.allIn[1];
      return pushTerminal(bothAllIn ? 'allin-showdown' : 'postflop', state);
    }

    const player = state.toAct;
    const actions = legalActions(state, player);
    const node: SpotActionNode = {
      kind: 'action',
      index: nodes.length,
      player,
      actions,
      children: [],
      invested: [...state.invested],
      offset: strategySize,
    };
    nodes.push(node);
    strategySize += actions.length * NUM_HANDS;

    for (const action of actions) {
      if (action.kind === 'fold') {
        node.children.push(pushFold(state, player));
      } else {
        node.children.push(build(applyAction(state, player, action)));
      }
    }
    return node.index;
  }

  function isRoundOver(state: SpotState): boolean {
    for (const p of [0, 1] as const) {
      if (state.allIn[p]) continue;
      if (!state.acted[p]) return false;
      if (state.invested[p] < state.currentBet) return false;
    }
    return true;
  }

  function legalActions(state: SpotState, player: 0 | 1): SpotAction[] {
    const out: SpotAction[] = [];
    const owed = state.currentBet - state.invested[player];
    const remaining = config.stack - state.invested[player];

    if (owed > 0) out.push({ kind: 'fold', to: 0, label: '폴드' });
    else out.push({ kind: 'check', to: 0, label: '체크' });

    // 아직 아무도 레이즈하지 않았는데 콜하는 건 림프다. 6인 트리와 같은 규칙을 적용한다.
    const isLimp = state.raiseCount === 0;
    if (owed > 0 && (!isLimp || config.allowLimp)) {
      if (owed < remaining) {
        out.push({ kind: 'call', to: state.currentBet, label: `콜 ${fmt(state.currentBet)}bb` });
      } else {
        out.push({ kind: 'call', to: config.stack, label: '콜 (올인)' });
      }
    }

    const raiseTo = nextRaiseSize(state, player);
    if (raiseTo !== null && raiseTo > state.currentBet && remaining > 0) {
      if (raiseTo >= config.stack * config.allInThreshold) {
        out.push({ kind: 'allin', to: config.stack, label: `올인 ${fmt(config.stack)}bb` });
      } else {
        out.push({ kind: 'raise', to: raiseTo, label: raiseLabel(state.raiseCount, raiseTo) });
      }
    }
    return out;
  }

  function nextRaiseSize(state: SpotState, player: 0 | 1): number | null {
    if (state.raiseCount >= 4) return null;
    const hero = positions[player];
    const villain = positions[1 - player];

    if (state.raiseCount === 0) {
      const base = config.openSize[hero];
      return base > 0 ? round(base) : null;
    }
    if (state.raiseCount === 1) {
      const mult = isInPosition(hero, villain)
        ? config.threeBetMultiplierIP
        : config.threeBetMultiplierOOP;
      return Math.min(round(state.lastRaiseTo * mult), config.stack);
    }
    if (state.raiseCount === 2) {
      return Math.min(round(state.lastRaiseTo * config.fourBetMultiplier), config.stack);
    }
    return config.stack;
  }

  function applyAction(state: SpotState, player: 0 | 1, action: SpotAction): SpotState {
    const next: SpotState = {
      invested: [...state.invested],
      acted: [...state.acted],
      allIn: [...state.allIn],
      toAct: state.toAct,
      currentBet: state.currentBet,
      raiseCount: state.raiseCount,
      lastRaiseTo: state.lastRaiseTo,
    };
    next.acted[player] = true;

    if (action.kind === 'call') {
      // 콜 금액이 내 스택을 넘을 수 없다. 초과분 반환은 터미널에서 정산한다.
      next.invested[player] = Math.min(action.to, config.stack);
      if (next.invested[player] >= config.stack) next.allIn[player] = true;
    } else if (action.kind === 'raise' || action.kind === 'allin') {
      next.invested[player] = action.to;
      next.currentBet = action.to;
      next.lastRaiseTo = action.to;
      next.raiseCount = state.raiseCount + 1;
      if (action.to >= config.stack) next.allIn[player] = true;
      next.acted[1 - player] = false;
    }

    next.toAct = (1 - player) as 0 | 1;
    return next;
  }

  function pushFold(state: SpotState, folder: 0 | 1): number {
    const node: SpotTerminalNode = {
      kind: 'terminal',
      index: nodes.length,
      terminal: 'fold',
      invested: [...state.invested],
      pot: state.invested[0] + state.invested[1] + definition.deadMoney,
      winner: (1 - folder) as 0 | 1,
    };
    nodes.push(node);
    return node.index;
  }

  function pushTerminal(terminal: SpotTerminalKind, state: SpotState): number {
    // 2인 팟에서 한쪽이 더 많이 넣었다면 초과분은 돌려받는다.
    const matched = Math.min(state.invested[0], state.invested[1]);
    const settled: [number, number] = [matched, matched];
    const node: SpotTerminalNode = {
      kind: 'terminal',
      index: nodes.length,
      terminal,
      invested: settled,
      pot: matched * 2 + definition.deadMoney,
    };
    nodes.push(node);
    return node.index;
  }
}

function raiseLabel(raiseCount: number, to: number): string {
  const names = ['오픈', '3벳', '4벳', '5벳'];
  return `${names[raiseCount] ?? '레이즈'} ${fmt(to)}bb`;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function round(x: number): number {
  return Math.round(x * 2) / 2;
}

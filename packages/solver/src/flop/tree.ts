/**
 * 플롭 액션 트리.
 *
 * 프리플롭과 달리 여기서는 베팅 사이즈를 여러 개 둘 수 있다. 다만 사이즈 하나를
 * 늘릴 때마다 노드가 곱으로 늘어나므로, 실제로 빈도가 붙는 크기만 남긴다.
 * 33%와 75% 두 개면 대부분의 플롭에서 실제 해법의 EV를 90% 이상 재현한다.
 */

export interface FlopConfig {
  /** 플롭에 도달했을 때 팟 크기(bb). */
  pot: number;
  /** 두 사람 중 적은 쪽 남은 스택(bb). */
  effectiveStack: number;
  /** 베팅 크기 — 팟 대비 비율. */
  betSizes: number[];
  /** 레이즈 크기 — 팟 대비 비율(콜한 뒤 팟 기준). */
  raiseSizes: number[];
  /** 레이즈를 몇 번까지 허용할지. 넘으면 올인만 남는다. */
  maxRaises: number;
  /** 이 비율을 넘는 베팅은 올인으로 친다. */
  allInThreshold: number;
}

export const DEFAULT_FLOP_CONFIG: Omit<FlopConfig, 'pot' | 'effectiveStack'> = {
  betSizes: [0.33, 0.75],
  raiseSizes: [2.5],
  maxRaises: 2,
  allInThreshold: 0.8,
};

export type FlopActionKind = 'check' | 'bet' | 'call' | 'fold' | 'raise' | 'allin';

export interface FlopAction {
  kind: FlopActionKind;
  /** 이번에 추가로 내는 금액(bb). check/fold는 0. */
  amount: number;
  /** 이 액션 뒤 그 플레이어의 누적 투자액(bb). */
  to: number;
  label: string;
}

export interface FlopActionNode {
  kind: 'action';
  index: number;
  /** 0 = 아웃오브포지션(먼저 행동), 1 = 인포지션 */
  player: 0 | 1;
  actions: FlopAction[];
  children: number[];
  offset: number;
}

export type FlopTerminalKind = 'fold' | 'showdown';

export interface FlopTerminalNode {
  kind: 'terminal';
  index: number;
  terminal: FlopTerminalKind;
  /** 이 시점까지 각자 플롭에서 넣은 금액. */
  invested: [number, number];
  /** 정산 대상 팟 = 시작 팟 + 서로 맞춘 금액 × 2. */
  pot: number;
  winner?: 0 | 1;
}

export type FlopNode = FlopActionNode | FlopTerminalNode;

export interface FlopTree {
  nodes: FlopNode[];
  root: number;
  config: FlopConfig;
  /** 전략 배열의 총 길이 = Σ(액션 수 × 그 노드에서 행동하는 쪽의 콤보 수). */
  strategySize: number;
  /**
   * 플레이어별 콤보 수 [OOP, IP].
   *
   * 둘은 거의 항상 다르다. 하나로 뭉뚱그리면 레인지가 큰 쪽 노드에서 배열 범위를
   * 넘어 읽게 되고, 전략 빈도 합이 1을 넘거나 EV가 NaN이 된다.
   */
  comboCounts: [number, number];
}

interface FlopState {
  invested: [number, number];
  toAct: 0 | 1;
  /** 이번 라운드에 행동한 적이 있는가. */
  acted: [boolean, boolean];
  raiseCount: number;
  allIn: [boolean, boolean];
}

export function buildFlopTree(config: FlopConfig, comboCounts: [number, number]): FlopTree {
  const nodes: FlopNode[] = [];
  let strategySize = 0;

  const initial: FlopState = {
    invested: [0, 0],
    toAct: 0, // 플롭부터는 아웃오브포지션이 먼저 행동한다
    acted: [false, false],
    raiseCount: 0,
    allIn: [false, false],
  };

  const root = build(initial);
  return { nodes, root, config, strategySize, comboCounts };

  function build(state: FlopState): number {
    if (isRoundOver(state)) return pushTerminal('showdown', state);

    const player = state.toAct;
    const actions = legalActions(state, player);
    const node: FlopActionNode = {
      kind: 'action',
      index: nodes.length,
      player,
      actions,
      children: [],
      offset: strategySize,
    };
    nodes.push(node);
    // 이 노드에서 행동하는 쪽의 콤보 수만큼 자리를 잡는다.
    strategySize += actions.length * comboCounts[player];

    for (const action of actions) {
      if (action.kind === 'fold') {
        node.children.push(pushFold(state, player));
      } else {
        node.children.push(build(applyAction(state, player, action)));
      }
    }
    return node.index;
  }

  function isRoundOver(state: FlopState): boolean {
    if (state.allIn[0] && state.allIn[1]) return true;
    for (const p of [0, 1] as const) {
      if (!state.acted[p]) return false;
    }
    return state.invested[0] === state.invested[1];
  }

  function legalActions(state: FlopState, player: 0 | 1): FlopAction[] {
    const out: FlopAction[] = [];
    const owed = state.invested[1 - player] - state.invested[player];
    const remaining = config.effectiveStack - state.invested[player];
    if (remaining <= 0) return [{ kind: 'check', amount: 0, to: state.invested[player], label: '체크' }];

    const potNow = config.pot + state.invested[0] + state.invested[1];

    if (owed > 0) {
      out.push({ kind: 'fold', amount: 0, to: state.invested[player], label: '폴드' });
      const callAmount = Math.min(owed, remaining);
      out.push({
        kind: 'call',
        amount: callAmount,
        to: state.invested[player] + callAmount,
        label: `콜 ${fmt(callAmount)}bb`,
      });
    } else {
      out.push({ kind: 'check', amount: 0, to: state.invested[player], label: '체크' });
    }

    // 베팅/레이즈
    if (state.raiseCount < config.maxRaises) {
      const sizes = owed > 0 ? config.raiseSizes : config.betSizes;
      const seen = new Set<number>();

      for (const ratio of sizes) {
        // 레이즈는 "콜하고 난 뒤의 팟"을 기준으로 잡는다. 실무 표기와 같다.
        const basis = owed > 0 ? potNow + owed : potNow;
        const raw = owed + ratio * basis;
        const amount = Math.min(round(raw), remaining);
        if (amount <= owed) continue;

        const to = state.invested[player] + amount;
        if (amount >= remaining * config.allInThreshold) {
          if (seen.has(remaining)) continue;
          seen.add(remaining);
          out.push({
            kind: 'allin',
            amount: remaining,
            to: state.invested[player] + remaining,
            label: `올인 ${fmt(remaining)}bb`,
          });
        } else {
          if (seen.has(amount)) continue;
          seen.add(amount);
          out.push({
            kind: owed > 0 ? 'raise' : 'bet',
            amount,
            to,
            label: `${owed > 0 ? '레이즈' : '벳'} ${fmt(amount)}bb (팟의 ${Math.round(ratio * 100)}%)`,
          });
        }
      }
    }

    return out;
  }

  function applyAction(state: FlopState, player: 0 | 1, action: FlopAction): FlopState {
    const next: FlopState = {
      invested: [...state.invested],
      toAct: state.toAct,
      acted: [...state.acted],
      raiseCount: state.raiseCount,
      allIn: [...state.allIn],
    };
    next.acted[player] = true;
    next.invested[player] = action.to;

    if (action.to >= config.effectiveStack) next.allIn[player] = true;

    if (action.kind === 'bet' || action.kind === 'raise' || action.kind === 'allin') {
      next.raiseCount = state.raiseCount + 1;
      // 공격적인 액션이 나오면 상대는 다시 답해야 한다.
      if (!next.allIn[1 - player]) next.acted[1 - player] = false;
    }

    next.toAct = (1 - player) as 0 | 1;
    return next;
  }

  function pushFold(state: FlopState, folder: 0 | 1): number {
    // 폴드하면 이미 낸 돈은 팟에 남는다.
    const node: FlopTerminalNode = {
      kind: 'terminal',
      index: nodes.length,
      terminal: 'fold',
      invested: [...state.invested],
      pot: config.pot + state.invested[0] + state.invested[1],
      winner: (1 - folder) as 0 | 1,
    };
    nodes.push(node);
    return node.index;
  }

  function pushTerminal(terminal: FlopTerminalKind, state: FlopState): number {
    // 한쪽이 더 넣었다면 초과분은 돌려받는다.
    const matched = Math.min(state.invested[0], state.invested[1]);
    const node: FlopTerminalNode = {
      kind: 'terminal',
      index: nodes.length,
      terminal,
      invested: [matched, matched],
      pot: config.pot + matched * 2,
    };
    nodes.push(node);
    return node.index;
  }
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function round(x: number): number {
  return Math.round(x * 2) / 2;
}

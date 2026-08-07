import { NUM_HANDS, combosOfHand, handRangeToCombos } from '@holdem/poker-core';
import {
  POSITION_LABELS_KO,
  isInPosition,
  outcomeOf,
  spotKey,
  type PreflopConfig,
  type Position,
  type SequenceAction,
  type SequenceState,
} from '@holdem/solver';

import type { FlopSetup } from './flop-setup';
import { getSpot, type PreflopData } from './preflop-data';

/**
 * 사람이 쌓아 만든 액션 시퀀스를 실제 레인지로 잇는다.
 *
 * 여기가 까다로운 이유: 사용자가 넣은 금액이 프리솔브 데이터의 설정과 다를 수 있다.
 * 2.5bb 기준으로 풀어둔 답을 3bb 오픈 상황에 쓰면 그냥 틀린 답이다.
 * 그래서 금액이 어긋나면 조용히 근사하지 않고 **다시 풀어야 한다고 말한다.**
 */

export type SequenceResolution =
  | { kind: 'ongoing'; toAct: Position }
  | { kind: 'walkover'; winner: Position; pot: number }
  | { kind: 'multiway'; players: Position[]; pot: number }
  /** 프리솔브 데이터로 바로 답할 수 있는 상황. */
  | { kind: 'ready'; setup: FlopSetup & { actionText: string } }
  /** 금액이 달라 다시 풀어야 하는 상황. 무엇이 다른지 함께 알려준다. */
  | { kind: 'needs-resolve'; config: PreflopConfig; changes: string[] };

export function resolveSequence(data: PreflopData, state: SequenceState): SequenceResolution {
  const outcome = outcomeOf(state);

  if (outcome.kind === 'ongoing') return { kind: 'ongoing', toAct: outcome.toAct };
  if (outcome.kind === 'walkover') {
    return { kind: 'walkover', winner: outcome.winner, pot: outcome.pot };
  }
  if (outcome.kind === 'multiway') {
    return { kind: 'multiway', players: outcome.players, pot: outcome.pot };
  }

  const live = state.actions.filter((a) => a.kind !== 'fold');
  const opener = live[0]?.position;
  if (!opener || live[0]!.kind !== 'raise') {
    // 아무도 레이즈하지 않고 플롭에 온 경우(림프 팟). 우리 모델에 없다.
    return {
      kind: 'needs-resolve',
      config: state.config,
      changes: ['아무도 레이즈하지 않은 팟(림프 팟)은 아직 계산해 두지 않았습니다.'],
    };
  }

  const [a, b] = outcome.players;
  const caller = a === opener ? b : a;
  const spot = data.spots.get(spotKey(opener, caller));
  if (!spot) {
    return {
      kind: 'needs-resolve',
      config: state.config,
      changes: [`${opener}와 ${caller}의 대결은 계산해 두지 않았습니다.`],
    };
  }

  // 금액이 프리솔브 설정과 맞는지 본다. 하나라도 다르면 다시 풀어야 한다.
  const mismatch = describeMismatch(live, data.config);
  if (mismatch.length > 0) {
    return { kind: 'needs-resolve', config: configFromSequence(live, state.config), changes: mismatch };
  }

  // 트리에서 이 시퀀스에 해당하는 경로를 찾는다.
  const path = matchTreePath(spot, live.slice(1));
  if (!path) {
    return {
      kind: 'needs-resolve',
      config: configFromSequence(live, state.config),
      changes: ['이 액션 조합은 계산해 둔 트리에 없습니다.'],
    };
  }

  return { kind: 'ready', setup: buildSetupFromPath(data, spot, opener, caller, path, live) };
}

/** 시퀀스의 금액이 프리솔브 설정과 어떻게 다른지. */
function describeMismatch(live: SequenceAction[], config: PreflopConfig): string[] {
  const changes: string[] = [];
  const open = live[0]!;
  const expectedOpen = config.openSize[open.position];

  if (Math.abs(open.to - expectedOpen) > 0.01) {
    changes.push(`오픈 ${fmt(open.to)}bb (계산해 둔 값은 ${fmt(expectedOpen)}bb)`);
  }

  const raises = live.filter((a) => a.kind === 'raise');
  if (raises.length >= 2) {
    const threeBet = raises[1]!;
    const ip = isInPosition(threeBet.position, open.position);
    const expected =
      open.to * (ip ? config.threeBetMultiplierIP : config.threeBetMultiplierOOP);
    if (Math.abs(threeBet.to - expected) > 0.51) {
      changes.push(`3벳 ${fmt(threeBet.to)}bb (계산해 둔 값은 ${fmt(expected)}bb)`);
    }
  }
  if (raises.length >= 3) {
    const fourBet = raises[2]!;
    const expected = raises[1]!.to * config.fourBetMultiplier;
    if (Math.abs(fourBet.to - expected) > 0.51) {
      changes.push(`4벳 ${fmt(fourBet.to)}bb (계산해 둔 값은 ${fmt(expected)}bb)`);
    }
  }

  return changes;
}

/** 사용자가 넣은 금액에서 설정을 역산한다. 이 설정으로 다시 풀면 그 상황의 답이 나온다. */
function configFromSequence(live: SequenceAction[], base: PreflopConfig): PreflopConfig {
  const open = live[0]!;
  const raises = live.filter((a) => a.kind === 'raise');
  const next: PreflopConfig = {
    ...base,
    openSize: { ...base.openSize, [open.position]: open.to },
  };

  if (raises.length >= 2) {
    const ratio = raises[1]!.to / open.to;
    const ip = isInPosition(raises[1]!.position, open.position);
    if (ip) next.threeBetMultiplierIP = round(ratio);
    else next.threeBetMultiplierOOP = round(ratio);
  }
  if (raises.length >= 3) {
    next.fourBetMultiplier = round(raises[2]!.to / raises[1]!.to);
  }
  return next;
}

type LoadedSpot = ReturnType<typeof getSpot>;

/** 스팟 트리에서 이 액션들에 해당하는 자식 인덱스 경로를 찾는다. */
function matchTreePath(spot: LoadedSpot, actions: SequenceAction[]): number[] | null {
  const path: number[] = [];
  let index = spot.tree.root;

  for (const action of actions) {
    const node = spot.tree.nodes[index];
    if (!node || node.kind !== 'action') return null;

    const found = node.actions.findIndex((candidate) => {
      if (action.kind === 'call') return candidate.kind === 'call';
      if (action.kind === 'check') return candidate.kind === 'check';
      if (action.kind === 'raise') {
        return (
          (candidate.kind === 'raise' || candidate.kind === 'allin') &&
          Math.abs(candidate.to - action.to) < 0.51
        );
      }
      return false;
    });
    if (found < 0) return null;

    path.push(found);
    index = node.children[found]!;
  }

  const terminal = spot.tree.nodes[index];
  return terminal && terminal.kind === 'terminal' && terminal.terminal === 'postflop'
    ? path
    : null;
}

function buildSetupFromPath(
  data: PreflopData,
  spot: LoadedSpot,
  opener: Position,
  caller: Position,
  path: number[],
  live: SequenceAction[],
): FlopSetup & { actionText: string } {
  // 트리를 따라 내려가며 각 액션의 전략을 곱해 그 시점의 레인지를 만든다.
  const reach: [Float32Array, Float32Array] = [
    new Float32Array(NUM_HANDS).fill(1),
    Float32Array.from(data.openFrequency[opener]),
  ];

  let index = spot.tree.root;
  for (const actionIndex of path) {
    const node = spot.tree.nodes[index]!;
    if (node.kind !== 'action') break;
    const player = node.player;
    for (let h = 0; h < NUM_HANDS; h++) {
      reach[player][h] *= spot.strategy[node.offset + actionIndex * NUM_HANDS + h]!;
    }
    index = node.children[actionIndex]!;
  }

  const terminal = spot.tree.nodes[index]!;
  const invested = terminal.kind === 'terminal' ? terminal.invested[0] : 0;
  const pot = terminal.kind === 'terminal' ? terminal.pot : 0;

  const callerIp = isInPosition(caller, opener);
  return {
    opener,
    caller,
    oop: callerIp ? opener : caller,
    ip: callerIp ? caller : opener,
    oopRange: handRangeToCombos(callerIp ? reach[1] : reach[0]),
    ipRange: handRangeToCombos(callerIp ? reach[0] : reach[1]),
    pot,
    effectiveStack: data.config.stack - invested,
    oopWidth: widthOf(callerIp ? reach[1] : reach[0]),
    ipWidth: widthOf(callerIp ? reach[0] : reach[1]),
    label: `${POSITION_LABELS_KO[opener].full}(${opener}) vs ${POSITION_LABELS_KO[caller].full}(${caller})`,
    actionText: live.map((a) => `${a.position} ${labelOf(a)}`).join(' → '),
  };
}

function labelOf(action: SequenceAction): string {
  if (action.kind === 'call') return `콜 ${fmt(action.to)}bb`;
  if (action.kind === 'check') return '체크';
  return `${fmt(action.to)}bb 레이즈`;
}

function widthOf(frequency: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) combos += frequency[h]! * combosOfHand(h).length;
  return (combos / 1326) * 100;
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

function round(x: number): number {
  return Math.round(x * 20) / 20;
}

import {
  NUM_HANDS,
  combosOfHand,
  handRangeToCombos,
  type ComboRange,
} from '@holdem/poker-core';
import {
  POSITIONS_6MAX,
  POSITION_LABELS_KO,
  isInPosition,
  type PreflopConfig,
  type Position,
} from '@holdem/solver';

import { getSpot, type PreflopData } from './preflop-data';

/**
 * 프리플롭 결과에서 "플롭을 볼 두 사람"을 꺼낸다.
 *
 * 플롭 솔버는 레인지 두 개와 팟·스택만 있으면 돌아간다. 그 값들이 이미
 * 프리플롭 해답 안에 들어 있으므로 여기서 뽑아 넘기기만 하면 된다.
 * 사람이 직접 레인지를 입력하게 하면 초보자는 손도 못 댄다.
 */

export interface FlopSetup {
  opener: Position;
  caller: Position;
  /** 플롭에서 먼저 행동하는 쪽. */
  oop: Position;
  ip: Position;
  oopRange: ComboRange;
  ipRange: ComboRange;
  /** 플롭 시작 팟(bb). */
  pot: number;
  /** 남은 스택 중 적은 쪽(bb). */
  effectiveStack: number;
  /** 레인지가 전체의 몇 %인지 — 화면에 그대로 띄운다. */
  oopWidth: number;
  ipWidth: number;
  label: string;
}

/** 싱글레이즈 팟이 만들어지는 (오픈, 콜) 짝을 모두 나열한다. */
export function listFlopSetups(): Array<{ opener: Position; caller: Position }> {
  const out: Array<{ opener: Position; caller: Position }> = [];
  for (let i = 0; i < POSITIONS_6MAX.length; i++) {
    for (let j = i + 1; j < POSITIONS_6MAX.length; j++) {
      out.push({ opener: POSITIONS_6MAX[i]!, caller: POSITIONS_6MAX[j]! });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 플롭까지 이어지는 모든 라인
// ---------------------------------------------------------------------------

export type PotType = 'srp' | '3bet' | '4bet';

export interface FlopLine extends FlopSetup {
  id: string;
  potType: PotType;
  /** "UTG 2.5bb 오픈 → CO 3벳 7.5bb → UTG 콜" */
  actionText: string;
}

const POT_TYPE_LABEL: Record<PotType, string> = {
  srp: '싱글레이즈 팟',
  '3bet': '3벳 팟',
  '4bet': '4벳 팟',
};

export function potTypeLabel(type: PotType): string {
  return POT_TYPE_LABEL[type];
}

/**
 * 프리플롭 해답에서 **플롭까지 이어지는 2인 라인을 전부** 뽑는다.
 *
 * 스팟 트리에는 오픈 → 3벳 → 4벳 → 5벳이 다 들어 있고, 그중 `postflop`으로
 * 끝나는 잎이 곧 "이 라인으로 플롭에 왔다"는 뜻이다. 각 잎까지 내려가며 액션마다
 * 그 플레이어의 전략을 곱하면 그 시점의 레인지가 나온다.
 *
 * 싱글레이즈 팟만 보여주던 이전 방식으로는 3벳 팟을 볼 수 없었는데,
 * 사실 계산은 이미 되어 있었고 꺼내오지 않았을 뿐이다.
 *
 * 세 명 이상이 보는 팟은 여기 없다. 스팟을 2인으로 쪼개 풀기 때문에
 * 애초에 그런 레인지가 계산된 적이 없다.
 */
export function enumerateFlopLines(data: PreflopData): FlopLine[] {
  const lines: FlopLine[] = [];

  for (const { opener, caller } of listFlopSetups()) {
    const spot = getSpot(data, opener, caller);
    const config = data.config;
    const dead = deadMoneyOf(opener, caller, config);

    // 스팟 트리에서 첫 번째로 행동하는 쪽이 caller(오픈에 대응하는 사람)다.
    const reach: [Float32Array, Float32Array] = [
      Float32Array.from(callerBaseRange(data, spot)),
      Float32Array.from(data.openFrequency[opener]),
    ];

    walk(spot.tree.root, reach, []);

    function walk(
      nodeIndex: number,
      current: [Float32Array, Float32Array],
      path: Array<{ player: 0 | 1; label: string }>,
    ): void {
      const node = spot.tree.nodes[nodeIndex]!;

      if (node.kind === 'terminal') {
        if (node.terminal !== 'postflop') return;
        // 액션이 없었다는 건 트리 구조상 나올 수 없지만 방어적으로 거른다.
        if (path.length === 0) return;

        const raises = path.filter((p) => p.label.includes('벳') || p.label.includes('올인'));
        const potType: PotType = raises.length >= 2 ? '4bet' : raises.length === 1 ? '3bet' : 'srp';

        // 스팟 트리의 0번은 caller, 1번은 opener다. 포지션으로 되돌린다.
        const callerIp = isInPosition(caller, opener);
        const invested = node.invested[0];
        const pot = invested * 2 + dead;

        lines.push({
          id: `${opener}>${caller}:${path.map((p) => p.label).join('|')}`,
          potType,
          opener,
          caller,
          oop: callerIp ? opener : caller,
          ip: callerIp ? caller : opener,
          oopRange: handRangeToCombos(callerIp ? current[1] : current[0]),
          ipRange: handRangeToCombos(callerIp ? current[0] : current[1]),
          pot,
          effectiveStack: config.stack - invested,
          oopWidth: widthOf(callerIp ? current[1] : current[0]),
          ipWidth: widthOf(callerIp ? current[0] : current[1]),
          label: `${POSITION_LABELS_KO[opener].full}(${opener}) vs ${POSITION_LABELS_KO[caller].full}(${caller})`,
          actionText: [
            `${opener} ${fmt(config.openSize[opener])}bb 오픈`,
            ...path.map((p) => `${p.player === 0 ? caller : opener} ${p.label}`),
          ].join(' → '),
        });
        return;
      }

      for (let a = 0; a < node.actions.length; a++) {
        const action = node.actions[a]!;
        if (action.kind === 'fold') continue; // 폴드하면 플롭을 못 본다

        const next: [Float32Array, Float32Array] = [
          Float32Array.from(current[0]),
          Float32Array.from(current[1]),
        ];
        const player = node.player;
        for (let h = 0; h < NUM_HANDS; h++) {
          next[player][h] = current[player][h]! * spot.strategy[node.offset + a * NUM_HANDS + h]!;
        }

        walk(node.children[a]!, next, [...path, { player, label: action.label }]);
      }
    }
  }

  return lines;
}

/** 스팟에 들어올 때 caller가 들고 있는 레인지 — 아직 아무 행동도 안 했으니 전 레인지다. */
function callerBaseRange(_data: PreflopData, _spot: ReturnType<typeof getSpot>): Float32Array {
  return new Float32Array(NUM_HANDS).fill(1);
}

export function buildFlopSetup(
  data: PreflopData,
  opener: Position,
  caller: Position,
): FlopSetup {
  const spot = getSpot(data, opener, caller);
  const root = spot.tree.nodes[spot.tree.root]!;
  if (root.kind !== 'action') throw new Error('스팟 루트가 액션 노드가 아닙니다');

  const callIndex = root.actions.findIndex((a) => a.kind === 'call');
  if (callIndex < 0) throw new Error(`${opener} vs ${caller}: 콜 액션이 없습니다`);

  // 콜한 쪽의 레인지 = 그 액션의 빈도. 오픈한 쪽은 오픈 레인지 전체가 그대로 온다.
  const callerFreq = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) {
    callerFreq[h] = spot.strategy[root.offset + callIndex * NUM_HANDS + h]!;
  }
  const openerFreq = data.openFrequency[opener];

  const callerIp = isInPosition(caller, opener);
  const ip = callerIp ? caller : opener;
  const oop = callerIp ? opener : caller;

  const config = data.config;
  const openTo = config.openSize[opener];
  const pot = openTo * 2 + deadMoneyOf(opener, caller, config);
  const effectiveStack = config.stack - openTo;

  return {
    opener,
    caller,
    oop,
    ip,
    oopRange: handRangeToCombos(callerIp ? openerFreq : callerFreq),
    ipRange: handRangeToCombos(callerIp ? callerFreq : openerFreq),
    pot,
    effectiveStack,
    oopWidth: widthOf(callerIp ? openerFreq : callerFreq),
    ipWidth: widthOf(callerIp ? callerFreq : openerFreq),
    label:
      `${POSITION_LABELS_KO[opener].full}(${opener})가 ${fmt(openTo)}bb 레이즈하고 ` +
      `${POSITION_LABELS_KO[caller].full}(${caller})가 콜`,
  };
}

/** 오픈한 사람도 콜한 사람도 아닌 자리가 두고 간 돈. */
function deadMoneyOf(opener: Position, caller: Position, config: PreflopConfig): number {
  let dead = 0;
  if (opener !== 'SB' && caller !== 'SB') dead += config.smallBlind;
  if (opener !== 'BB' && caller !== 'BB') dead += config.bigBlind;
  return dead;
}

function widthOf(frequency: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) combos += frequency[h]! * combosOfHand(h).length;
  return (combos / 1326) * 100;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

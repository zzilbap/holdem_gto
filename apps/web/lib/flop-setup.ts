import { NUM_HANDS, handRangeToCombos, type ComboRange } from '@holdem/poker-core';
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
  for (let h = 0; h < NUM_HANDS; h++) {
    const shape = h % 13 === Math.floor(h / 13) ? 6 : h % 13 > Math.floor(h / 13) ? 4 : 12;
    combos += frequency[h]! * shape;
  }
  return (combos / 1326) * 100;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

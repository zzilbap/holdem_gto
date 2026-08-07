import type { ComboRange } from '@holdem/poker-core';
import type { Position } from '@holdem/solver';

/**
 * 플롭 솔버에 넘길 재료.
 *
 * 레인지 두 개와 팟·스택만 있으면 플롭은 풀린다. 이 값들은 사용자가 직접 입력한
 * 프리플롭 액션에서 나온다 (`sequence-resolve.ts`). 사람이 레인지를 손으로 적게
 * 하면 초보자는 손도 못 대므로, 액션만 넣으면 나머지는 알아서 채운다.
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

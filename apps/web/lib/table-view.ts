import { POSITIONS_6MAX, isInPosition, type Position } from '@holdem/solver';

import type { PreflopData } from './preflop-data';
import type { Scenario } from './scenario';

/**
 * 상황을 테이블 그림으로 바꾼다.
 *
 * 자리 여섯 곳 모두에 상태를 채운다. 하나라도 비워두면 "얘는 뭘 한 거지?"에서
 * 막힌다 — 실제로 3벳 팟 화면에서 SB·BB가 빈칸으로 남아 그 질문을 받았다.
 *
 * 팟은 자리에 놓인 돈을 더해서 구한다. 따로 계산하면 어긋난다.
 * 실제로 4벳 팟이 25.5bb여야 하는데 20.5bb로 떴었다.
 */

export type SeatStatus = 'folded' | 'pending' | 'live';

export interface SeatState {
  status: SeatStatus;
  /** 지금까지 넣은 금액(bb). */
  invested?: number;
  /** 마지막으로 올린 사람인지. */
  aggressor?: boolean;
}

export interface TableView {
  hero: Position;
  seats: Record<Position, SeatState>;
  pot: number;
}

export function describeTable(scenario: Scenario, data: PreflopData): TableView {
  const config = data.config;
  const heroIndex = POSITIONS_6MAX.indexOf(scenario.hero);
  const seats = {} as Record<Position, SeatState>;

  const blindOf = (position: Position) =>
    position === 'SB' ? config.smallBlind : position === 'BB' ? config.bigBlind : 0;

  /** 접은 사람도 블라인드를 냈다면 그 돈은 팟에 남는다. */
  const fold = (position: Position) => {
    seats[position] = { status: 'folded', invested: blindOf(position) };
  };
  const pending = (position: Position) => {
    seats[position] = { status: 'pending', invested: blindOf(position) };
  };
  const live = (position: Position, invested: number, aggressor = false) => {
    seats[position] = { status: 'live', invested, aggressor };
  };

  if (scenario.kind === 'open') {
    POSITIONS_6MAX.forEach((position, index) => {
      if (index < heroIndex) fold(position);
      else if (index > heroIndex) pending(position);
    });
    live(scenario.hero, blindOf(scenario.hero));
    return { hero: scenario.hero, seats, pot: sumInvested(seats) };
  }

  const villain = scenario.villain;

  if (scenario.kind === 'vs-open') {
    POSITIONS_6MAX.forEach((position, index) => {
      if (position === villain || position === scenario.hero) return;
      // 오프너와 나 사이는 이미 접었고, 내 뒤는 아직 차례가 오지 않았다.
      if (index < heroIndex) fold(position);
      else pending(position);
    });
    live(villain, config.openSize[villain], true);
    live(scenario.hero, blindOf(scenario.hero));
    return { hero: scenario.hero, seats, pot: sumInvested(seats) };
  }

  /*
   * vs-3bet: 내가 열고 상대가 3벳했다.
   * vs-4bet: 상대가 열고 내가 3벳했는데 상대가 4벳했다.
   *
   * 어느 쪽이든 나와 상대를 뺀 전원은 이미 접었다 — 3벳까지 오갔다면
   * 뒷자리도 답을 마쳤기 때문이다. 여기서 '아직'인 자리는 없다.
   */
  const opener = scenario.kind === 'vs-3bet' ? scenario.hero : villain;
  const threeBetter = scenario.kind === 'vs-3bet' ? villain : scenario.hero;
  const openTo = config.openSize[opener];
  const threeBetTo = round(
    openTo *
      (isInPosition(threeBetter, opener)
        ? config.threeBetMultiplierIP
        : config.threeBetMultiplierOOP),
  );

  POSITIONS_6MAX.forEach((position) => {
    if (position === scenario.hero || position === villain) return;
    fold(position);
  });

  if (scenario.kind === 'vs-3bet') {
    live(scenario.hero, openTo);
    live(villain, threeBetTo, true);
  } else {
    live(scenario.hero, threeBetTo);
    live(villain, round(threeBetTo * config.fourBetMultiplier), true);
  }

  return { hero: scenario.hero, seats, pot: sumInvested(seats) };
}

function sumInvested(seats: Record<Position, SeatState>): number {
  let total = 0;
  for (const position of POSITIONS_6MAX) total += seats[position]?.invested ?? 0;
  return Math.round(total * 2) / 2;
}

function round(value: number): number {
  return Math.round(value * 2) / 2;
}

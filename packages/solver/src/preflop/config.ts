/**
 * 프리플롭 게임 설정.
 *
 * 사이징은 GTO Wizard의 기본 프리셋을 따른다. 사이즈를 바꾸면 정답도 바뀌므로
 * 여기 숫자들이 곧 "우리가 어떤 게임을 풀고 있는지"의 정의다.
 */

export const POSITIONS_6MAX = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const;
export type Position = (typeof POSITIONS_6MAX)[number];

/** 초보자에게 포지션을 한국어로 설명할 때 쓰는 이름. */
export const POSITION_LABELS_KO: Record<Position, { short: string; full: string; hint: string }> = {
  UTG: { short: 'UTG', full: '언더더건', hint: '가장 먼저 액션하는 자리. 뒤에 5명이 남아 가장 불리하다.' },
  HJ: { short: 'HJ', full: '하이잭', hint: 'UTG 다음 자리. 아직 뒤에 4명이 남았다.' },
  CO: { short: 'CO', full: '컷오프', hint: '버튼 바로 앞. 여기부터 레인지를 꽤 넓힐 수 있다.' },
  BTN: { short: 'BTN', full: '버튼', hint: '플롭 이후 항상 마지막에 행동하는 최고의 자리.' },
  SB: { short: 'SB', full: '스몰블라인드', hint: '0.5bb를 이미 냈지만 플롭 이후 계속 먼저 행동해야 한다.' },
  BB: { short: 'BB', full: '빅블라인드', hint: '1bb를 이미 냈다. 그래서 남들보다 싸게 콜할 수 있다.' },
};

export interface PreflopConfig {
  /** 참가 인원. 지금은 6맥스만 검증되어 있다. */
  playerCount: number;
  /** bb 단위 시작 스택. 전원 동일하다고 가정한다. */
  stack: number;
  smallBlind: number;
  bigBlind: number;
  /** 전원 앤티(bb 단위). 캐시게임 기본은 0. */
  ante: number;

  /** 포지션별 오픈 레이즈 사이즈(bb). */
  openSize: Record<Position, number>;
  /** 3벳 사이즈 = 오픈액 × 배수. 포지션 관계에 따라 다르다. */
  threeBetMultiplierIP: number;
  threeBetMultiplierOOP: number;
  /** 4벳 사이즈 = 3벳액 × 배수. */
  fourBetMultiplier: number;
  /** 스퀴즈(콜러가 낀 상태의 3벳) 시 콜러 1명당 더하는 오픈액 배수. */
  squeezeExtraPerCaller: number;
  /** 이 금액을 넘는 레이즈는 그냥 올인으로 친다. 트리에 의미 없는 가지를 안 만들기 위한 것. */
  allInThreshold: number;

  /**
   * 아무도 레이즈하지 않은 상태에서 콜(림프)을 허용할지.
   *
   * GTO 해법에서 UTG~BTN 림프는 빈도가 사실상 0이다. 그런데 트리에는
   * 남아서 노드 수를 자릿수 단위로 불린다 (측정: 켜면 37만 노드/477MB,
   * 끄면 1/20 이하). 첫 버전은 끈다.
   */
  allowLimp: boolean;
}

export const DEFAULT_6MAX_100BB: PreflopConfig = {
  playerCount: 6,
  stack: 100,
  smallBlind: 0.5,
  bigBlind: 1,
  ante: 0,
  /**
   * BB 값은 오픈 사이즈가 아니라 **림프에 대한 아이솔레이션 레이즈**다.
   * BB는 먼저 열 일이 없으므로(이미 1bb를 냈다) 이 자리를 그 용도로 쓴다.
   *
   * 0으로 두면 BB가 림프를 응징할 수 없고, 그러면 SB 림프가 과대평가된다
   * (실측: 림프 68.7% / 폴드 1.2%라는 말이 안 되는 값이 나왔다).
   */
  openSize: { UTG: 2.5, HJ: 2.5, CO: 2.5, BTN: 2.5, SB: 3, BB: 4 },
  threeBetMultiplierIP: 3,
  threeBetMultiplierOOP: 4,
  fourBetMultiplier: 2.2,
  squeezeExtraPerCaller: 1,
  allInThreshold: 0.75,
  allowLimp: false,
};

/** 두 포지션 중 누가 플롭에서 나중에 행동하는가. 값이 클수록 유리한 자리. */
const POSTFLOP_ORDER: Record<Position, number> = {
  SB: 0,
  BB: 1,
  UTG: 2,
  HJ: 3,
  CO: 4,
  BTN: 5,
};

export function isInPosition(hero: Position, villain: Position): boolean {
  return POSTFLOP_ORDER[hero] > POSTFLOP_ORDER[villain];
}

export function positionAt(index: number): Position {
  return POSITIONS_6MAX[index]!;
}

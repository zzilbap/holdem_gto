import { NUM_HANDS, combosOfHand, handIndexToGrid, handShape } from '@holdem/poker-core';

/**
 * 에퀴티 실현율 (Equity Realization, 흔히 R).
 *
 * 프리플롭에서 콜하고 플롭을 보러 가면, 그 뒤에 벌어질 일의 가치를 알아야 한다.
 * 정확히 하려면 포스트플롭을 전부 풀어야 하는데 그건 프리플롭 CFR 안에서 할 수 없다.
 *
 * 그래서 표준 근사를 쓴다:
 *
 *     플롭 이후 얻는 몫 ≈ 에퀴티 × R
 *
 * R < 1이면 "가진 에퀴티만큼도 못 챙긴다"는 뜻이다. 아웃오브포지션이면
 * 매 스트리트 먼저 행동해야 해서 손해를 보고, 오프수트 하이카드는 맞아도
 * 키커 싸움에 말려 못 챙긴다. 반대로 수딧·커넥터·포켓페어는 맞으면
 * 크게 이기는 형태라 1을 넘긴다.
 *
 * **이건 근사이고, 프리플롭 차트 정확도의 주된 오차원이다.**
 * 그래서 인터페이스 뒤에 뒀다. 플롭 솔버가 붙으면 실제 솔브 결과로 만든
 * 구현으로 갈아끼울 수 있고, 그때 프리플롭 CFR 코드는 손대지 않는다.
 */
export interface RealizationContext {
  inPosition: boolean;
  /** 남은 스택 ÷ 팟. 클수록 플롭 이후에 할 게 많아 포지션 차이가 커진다. */
  spr: number;
  /**
   * 상대 레인지가 전체의 몇 %인가 (0~1).
   *
   * 이걸 빼면 SB가 무너진다. SB는 아웃오브포지션이지만 상대(BB)가 거의 랜덤이라
   * 실제로는 에퀴티를 잘 챙긴다. 반대로 BB가 UTG의 좁고 강한 레인지를 상대할 때는
   * 같은 아웃오브포지션이라도 훨씬 못 챙긴다. 포지션만 보면 이 둘을 구분할 수 없다.
   */
  villainRangeWidth: number;
}

export interface RealizationModel {
  /** 169칸 각각의 R값. 호출 결과를 캐시해서 쓰기 좋게 배열로 준다. */
  factors(context: RealizationContext): Float32Array;
  readonly name: string;
}

/**
 * 문헌과 솔버 출력에서 관찰되는 값을 손으로 맞춘 모델.
 *
 * 기준선은 포지션에서 온다 (IP 1.06 / OOP 0.94). 여기에 핸드 모양으로 보정한다:
 *
 *  - 포켓페어: 셋을 맞추면 결과가 분명해서 실현율이 높다. 낮은 페어일수록 더 그렇다.
 *  - 수딧: 플러시 가능성이 백도어까지 포함해 가치를 지켜준다.
 *  - 오프수트 갭: 맞아도 애매한 원페어로 끝나는 경우가 많아 가장 낮다.
 *  - 커넥터: 스트레이트 가능성만큼 보정.
 */
export class HeuristicRealization implements RealizationModel {
  readonly name = 'heuristic';
  private cache = new Map<string, Float32Array>();

  factors({ inPosition, spr, villainRangeWidth }: RealizationContext): Float32Array {
    const key = `${inPosition}:${spr.toFixed(1)}:${villainRangeWidth.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const out = new Float32Array(NUM_HANDS);

    /**
     * 두 값의 합은 반드시 2여야 한다.
     *
     * 실현 몫은 `에퀴티 × R`이고 두 사람의 에퀴티 합은 1이다. 에퀴티가 반반일 때
     * 팟이 정확히 나뉘려면 0.5 × (R_IP + R_OOP) = 1, 즉 합이 2가 되어야 한다.
     * 합이 2를 벗어나면 팟에 없던 돈이 생기거나 사라져 EV가 어긋난다.
     *
     * 0.87 / 1.13은 실측에 맞춰 잡았다. 처음엔 0.94 / 1.06으로 뒀는데
     * 그러면 BB가 UTG 오픈에 76%나 계속 가는 결과가 나왔다 —
     * 아웃오브포지션에서 넓은 레인지로 플롭에 가는 손해를 너무 적게 잡은 것이다.
     */
    const base = inPosition ? 1.14 : 0.86;

    // SPR이 낮을수록 포지션 이점이 줄어든다. 올인에 가까우면 R은 1로 수렴한다.
    const positionWeight = Math.min(1, spr / 6);
    const adjustedBase = 1 + (base - 1) * positionWeight;

    /**
     * 상대 레인지가 넓을수록 내가 잘 실현한다.
     *
     * 넓은 레인지에는 플롭을 못 맞춘 패가 많아 밀어붙이기 쉽고, 좁고 강한 레인지는
     * 뭘 해도 값을 못 뺀다. 기준은 35% — 그보다 넓으면 가산, 좁으면 감산이다.
     */
    const widthAdjust = 1 + WIDTH_SENSITIVITY * (villainRangeWidth - WIDTH_BASELINE);

    for (let h = 0; h < NUM_HANDS; h++) {
      out[h] = adjustedBase * widthAdjust * shapeMultiplier(h);
    }

    this.cache.set(key, out);
    return out;
  }
}

/**
 * 핸드 모양별 보정.
 *
 * 값의 **퍼짐이 중요하다.** 처음엔 0.94~1.06 안에 다 몰아넣었는데, 그러면
 * 약한 오프수트도 강한 수딧과 비슷하게 값을 챙기는 셈이 되어 BB가 쓰레기 패까지
 * 콜하는 결과가 나온다. 실제로는 아웃오브포지션의 약한 오프수트가 0.7 근처까지 떨어진다.
 *
 * 콤보 가중 평균은 정확히 1이 되도록 아래에서 정규화한다. 그래야 IP·OOP 기준값의
 * 합 2가 유지되고 팟에 없던 돈이 생기지 않는다.
 */
function rawShapeMultiplier(handIndex: number): number {
  const shape = handShape(handIndex);
  const { row, col } = handIndexToGrid(handIndex);

  if (shape === 'pair') {
    // row 0 = AA … row 12 = 22. 낮은 페어일수록 셋을 맞추는지로 결과가 갈려 실현율이 좋다.
    const lowness = row / 12;
    return 1.04 + 0.06 * lowness;
  }

  const highPos = Math.min(row, col);
  const lowPos = Math.max(row, col);
  const gap = lowPos - highPos - 1; // 0이면 커넥터
  const connectedness = Math.max(0, 1 - gap / 4);
  const highCardStrength = 1 - highPos / 12;

  if (shape === 'suited') {
    // 플러시 가능성이 백도어까지 값을 지켜준다.
    return 1.02 + 0.08 * connectedness;
  }

  // 오프수트. 하이카드가 약한데 갭까지 크면 맞아도 애매한 원페어로 끝난다.
  return 0.8 + 0.12 * connectedness + 0.1 * highCardStrength;
}

const SHAPE = (() => {
  const raw = new Float32Array(NUM_HANDS);
  let weighted = 0;
  for (let h = 0; h < NUM_HANDS; h++) {
    raw[h] = rawShapeMultiplier(h);
    weighted += raw[h] * combosOfHand(h).length;
  }
  const normalizer = 1326 / weighted;
  const out = new Float32Array(NUM_HANDS);
  for (let h = 0; h < NUM_HANDS; h++) out[h] = raw[h] * normalizer;
  return out;
})();

function shapeMultiplier(handIndex: number): number {
  return SHAPE[handIndex]!;
}

const WIDTH_BASELINE = 0.35;
const WIDTH_SENSITIVITY = 0.22;

/** 실현율을 아예 무시하고 싶을 때 (검증·비교용). */
export class NoRealization implements RealizationModel {
  readonly name = 'none';
  private readonly ones = new Float32Array(NUM_HANDS).fill(1);
  factors(): Float32Array {
    return this.ones;
  }
}

/** 레인지가 전체의 몇 %를 차지하는지 (0~1). 실현율 보정의 입력이다. */
export function rangeWidthOf(range: Float32Array): number {
  let combos = 0;
  for (let h = 0; h < NUM_HANDS; h++) combos += range[h]! * combosOfHand(h).length;
  return combos / 1326;
}

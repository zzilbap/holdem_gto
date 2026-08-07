import { NUM_HANDS, handIndexToGrid, handShape } from '@holdem/poker-core';

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
export interface RealizationModel {
  /** 169칸 각각의 R값. 호출 결과를 캐시해서 쓰기 좋게 배열로 준다. */
  factors(inPosition: boolean, spr: number): Float32Array;
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

  factors(inPosition: boolean, spr: number): Float32Array {
    const key = `${inPosition}:${spr.toFixed(1)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const out = new Float32Array(NUM_HANDS);
    const base = inPosition ? 1.06 : 0.94;

    // SPR이 낮을수록 포지션 이점이 줄어든다. 올인에 가까우면 R은 1로 수렴한다.
    const positionWeight = Math.min(1, spr / 6);
    const adjustedBase = 1 + (base - 1) * positionWeight;

    for (let h = 0; h < NUM_HANDS; h++) {
      out[h] = adjustedBase * shapeMultiplier(h);
    }

    this.cache.set(key, out);
    return out;
  }
}

function shapeMultiplier(handIndex: number): number {
  const shape = handShape(handIndex);
  const { row, col } = handIndexToGrid(handIndex);

  if (shape === 'pair') {
    // row 0 = AA … row 12 = 22. 낮은 페어일수록 셋 마이닝 의존도가 높아 실현율이 좋다.
    const lowness = row / 12;
    return 1.0 + 0.06 * lowness;
  }

  const highPos = Math.min(row, col);
  const lowPos = Math.max(row, col);
  const gap = lowPos - highPos - 1; // 0이면 커넥터
  const connectedness = Math.max(0, 1 - gap / 4);

  if (shape === 'suited') {
    return 1.03 + 0.03 * connectedness;
  }

  // 오프수트. 하이카드가 약한데 갭까지 크면 가장 나쁘다.
  const highCardStrength = 1 - highPos / 12;
  return 0.94 + 0.03 * connectedness + 0.02 * highCardStrength;
}

/** 실현율을 아예 무시하고 싶을 때 (검증·비교용). */
export class NoRealization implements RealizationModel {
  readonly name = 'none';
  private readonly ones = new Float32Array(NUM_HANDS).fill(1);
  factors(): Float32Array {
    return this.ones;
  }
}

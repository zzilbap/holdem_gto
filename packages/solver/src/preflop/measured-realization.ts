import { NUM_HANDS } from '@holdem/poker-core';
import type { RealizationContext, RealizationModel } from './realization';

/**
 * 플롭을 실제로 풀어서 잰 실현율.
 *
 * `HeuristicRealization`이 공식으로 추측하던 자리를 측정값으로 대체한다.
 * 프리플롭 CFR 코드는 이 교체를 모른다 — `RealizationModel` 인터페이스가 그 경계다.
 */

export interface RealizationData {
  version: 1;
  generatedAt: string;
  /** 측정에 쓴 보드 수. 많을수록 표본 잡음이 준다. */
  boards: number;
  /** 169칸 실현율. */
  oop: readonly number[];
  ip: readonly number[];
  /** 측정 당시 조건. 다른 조건에 쓸 때 얼마나 보정할지의 기준점이 된다. */
  context: {
    spr: number;
    /** 아웃오브포지션이 상대한 레인지의 폭. */
    oopVillainWidth: number;
    ipVillainWidth: number;
  };
}

export class MeasuredRealization implements RealizationModel {
  readonly name = 'measured';
  private readonly oop: Float32Array;
  private readonly ip: Float32Array;
  private readonly cache = new Map<string, Float32Array>();

  constructor(private readonly data: RealizationData) {
    this.oop = Float32Array.from(data.oop);
    this.ip = Float32Array.from(data.ip);
  }

  factors({ inPosition, spr, villainRangeWidth }: RealizationContext): Float32Array {
    const key = `${inPosition}:${spr.toFixed(1)}:${villainRangeWidth.toFixed(2)}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const base = inPosition ? this.ip : this.oop;
    const measuredWidth = inPosition
      ? this.data.context.ipVillainWidth
      : this.data.context.oopVillainWidth;

    /**
     * 측정은 특정 조건 하나에서만 했으므로, 다른 조건에는 보정해서 쓴다.
     *
     * 상대 레인지가 측정 때보다 넓으면 더 잘 실현하고, 좁으면 덜 실현한다.
     * SPR이 낮으면 포지션 차이가 줄어 R이 1로 수렴한다.
     */
    const widthAdjust = 1 + WIDTH_SENSITIVITY * (villainRangeWidth - measuredWidth);
    const sprWeight = Math.min(1, spr / 6);

    const out = new Float32Array(NUM_HANDS);
    for (let h = 0; h < NUM_HANDS; h++) {
      const measured = base[h]! * widthAdjust;
      // SPR이 낮을수록 측정값과 1 사이를 당긴다.
      out[h] = 1 + (measured - 1) * sprWeight;
    }

    this.cache.set(key, out);
    return out;
  }
}

const WIDTH_SENSITIVITY = 0.22;

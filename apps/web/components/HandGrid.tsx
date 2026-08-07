'use client';

import { NUM_HANDS, handIndexToString } from '@holdem/poker-core';
import type { AdviceOption } from '@/lib/scenario';

/**
 * 13×13 핸드 매트릭스.
 *
 * 초보자 화면에서는 **패를 고르는 도구**로 쓰고, 심화 뷰에서는 레인지 전체를
 * 보여주는 용도로 쓴다. 같은 컴포넌트지만 역할이 둘이라 `showFill`로 나눈다.
 *
 * 칸 하나를 액션 색으로 세로로 쌓아 칠한다. 빈도가 섞인 패는 칸 안에서
 * 비율이 그대로 보이므로, 숫자를 읽지 않아도 "이건 반반이구나"가 전달된다.
 */

export interface HandGridProps {
  selected: number | null;
  onSelect: (handIndex: number) => void;
  /** 칸마다 액션별 빈도. 없으면 회색 격자로만 그린다. */
  fills?: (handIndex: number) => AdviceOption[] | null;
  showFill?: boolean;
}

const FILL_CLASS: Record<AdviceOption['kind'], string> = {
  fold: 'fill-fold',
  check: 'fill-check',
  call: 'fill-call',
  raise: 'fill-raise',
  allin: 'fill-allin',
};

/** 칠하는 순서. 공격적인 액션이 위로 오게 해서 눈에 먼저 들어오게 한다. */
const STACK_ORDER: AdviceOption['kind'][] = ['allin', 'raise', 'call', 'check', 'fold'];

export function HandGrid({ selected, onSelect, fills, showFill = true }: HandGridProps) {
  return (
    <div className="grid-viewport">
      <div className="hand-grid" role="grid" aria-label="핸드 선택">
        {Array.from({ length: NUM_HANDS }, (_, handIndex) => {
          const label = handIndexToString(handIndex);
          const options = showFill && fills ? fills(handIndex) : null;
          const layers = options ? buildLayers(options) : [];
          const isEmpty = layers.length === 0;

          return (
            <button
              key={handIndex}
              type="button"
              className={`hand-cell${isEmpty ? ' empty' : ''}`}
              aria-pressed={selected === handIndex}
              onClick={() => onSelect(handIndex)}
              title={describeCell(label, options)}
            >
              {layers.map((layer) => (
                <span
                  key={layer.kind}
                  className={`fill ${FILL_CLASS[layer.kind]}`}
                  style={{ top: `${layer.top}%`, height: `${layer.height}%` }}
                />
              ))}
              <span className="label">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface Layer {
  kind: AdviceOption['kind'];
  top: number;
  height: number;
}

function buildLayers(options: AdviceOption[]): Layer[] {
  const byKind = new Map(options.map((o) => [o.kind, o.frequency]));
  const layers: Layer[] = [];
  let cursor = 0;

  for (const kind of STACK_ORDER) {
    const frequency = byKind.get(kind) ?? 0;
    // 1% 미만은 칠해도 보이지 않고 경계선만 지저분해진다.
    if (frequency < 0.01) continue;
    const height = frequency * 100;
    layers.push({ kind, top: cursor, height });
    cursor += height;
  }
  return layers;
}

function describeCell(label: string, options: AdviceOption[] | null): string {
  if (!options) return label;
  const parts = options
    .filter((o) => o.frequency >= 0.01)
    .sort((a, b) => b.frequency - a.frequency)
    .map((o) => `${o.name} ${Math.round(o.frequency * 100)}%`);
  return parts.length > 0 ? `${label} — ${parts.join(' · ')}` : label;
}

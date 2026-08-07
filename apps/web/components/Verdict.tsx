'use client';

import { handIndexToString } from '@holdem/poker-core';
import type { Advice, AdviceOption } from '@/lib/scenario';

/**
 * 결론 카드.
 *
 * 이 화면에서 가장 중요한 물건이다. 초보자가 알고 싶은 건 "그래서 뭘 하냐"이고,
 * 그 답이 제일 크게, 제일 먼저 나와야 한다. 빈도 막대와 근거는 그 아래로 밀어둔다.
 */

const BAR_COLOR: Record<AdviceOption['kind'], string> = {
  fold: 'var(--fold)',
  check: 'var(--check)',
  call: 'var(--call)',
  raise: 'var(--raise)',
  allin: 'var(--allin)',
};

export function Verdict({ advice, handIndex }: { advice: Advice; handIndex: number }) {
  // 일어나지 않는 상황이면 빈도 막대를 아예 보여주지 않는다.
  // 숫자를 흐리게라도 띄우면 초보자는 그걸 조언으로 읽는다.
  if (advice.unreachable) {
    return (
      <div className="verdict tone-unreachable">
        <span className="hand-badge">{handIndexToString(handIndex)}</span>
        <h3>{advice.headline}</h3>
        <p className="subline">{advice.subline}</p>
        <p className="reason">{advice.reason}</p>
      </div>
    );
  }

  return (
    <div className={`verdict tone-${advice.primary.kind}`}>
      <span className="hand-badge">{handIndexToString(handIndex)}</span>
      <h3>{advice.headline}</h3>
      <p className="subline">{advice.subline}</p>

      <div className="bars">
        {advice.options.map((option) => (
          <div className="bar-row" key={option.kind}>
            <span className="who">{option.name}</span>
            <span className="track">
              <span
                className="value"
                style={{
                  width: `${Math.max(0, Math.min(100, option.frequency * 100))}%`,
                  background: BAR_COLOR[option.kind],
                }}
              />
            </span>
            <span className="pct">{formatPercent(option.frequency)}</span>
            {option.frequency >= 0.08 && <span className="detail">{option.detail}</span>}
          </div>
        ))}
      </div>

      <p className="reason">{advice.reason}</p>
    </div>
  );
}

function formatPercent(value: number): string {
  const pct = value * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

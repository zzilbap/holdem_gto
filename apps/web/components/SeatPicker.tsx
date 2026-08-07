'use client';

import { POSITIONS_6MAX, POSITION_LABELS_KO, type Position } from '@holdem/solver';

/**
 * 내 자리 고르기.
 *
 * 포지션 약어(UTG, HJ...)만 띄우면 초보자는 어디가 유리한 자리인지 모른다.
 * 그래서 한글 이름을 같이 박아두고, 순서는 실제 액션 순서 그대로 둔다.
 */
export function SeatPicker({
  value,
  onChange,
}: {
  value: Position;
  onChange: (position: Position) => void;
}) {
  return (
    <div className="seat-row" role="group" aria-label="내 자리">
      {POSITIONS_6MAX.map((position) => {
        const label = POSITION_LABELS_KO[position];
        return (
          <button
            key={position}
            type="button"
            className="seat"
            aria-pressed={value === position}
            onClick={() => onChange(position)}
            title={label.hint}
          >
            <span className="code">{position}</span>
            <span className="name">{label.full}</span>
          </button>
        );
      })}
    </div>
  );
}

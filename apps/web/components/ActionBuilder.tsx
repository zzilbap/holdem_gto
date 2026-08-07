'use client';

import { POSITIONS_6MAX, POSITION_LABELS_KO, legalActions, type SequenceState } from '@holdem/solver';
import { useState } from 'react';

/**
 * 프리플롭 액션을 직접 쌓는 입력기.
 *
 * 미리 만들어 둔 목록에서 고르는 방식으로는 "UTG가 3bb 열고 CO가 12bb로 3벳" 같은
 * 실제로 친 판을 넣을 수 없다. 여기서는 차례가 온 사람의 선택지를 보여주고
 * 하나씩 눌러 나가게 한다. 레이즈는 금액을 직접 고칠 수 있다.
 */

export interface ActionBuilderProps {
  state: SequenceState;
  onAction: (kind: 'fold' | 'check' | 'call' | 'raise', to?: number) => void;
  onUndo: () => void;
  onReset: () => void;
  disabled?: boolean;
}

export function ActionBuilder({ state, onAction, onUndo, onReset, disabled }: ActionBuilderProps) {
  const [raiseTo, setRaiseTo] = useState<number | null>(null);
  const actions = legalActions(state);
  const toAct = state.toAct;

  // 차례가 넘어가면 금액 입력칸을 그 사람의 추천값으로 되돌린다.
  const suggested = actions.find((a) => a.kind === 'raise')?.to ?? null;
  const [lastActor, setLastActor] = useState<number | null>(toAct);
  if (lastActor !== toAct) {
    setLastActor(toAct);
    setRaiseTo(suggested);
  }
  const raiseValue = raiseTo ?? suggested ?? 0;

  return (
    <div className="builder">
      <ol className="builder-log">
        {state.actions.length === 0 && <li className="builder-empty">아직 아무 일도 없었습니다</li>}
        {state.actions.map((action, index) => (
          <li key={index} className={action.kind === 'fold' ? 'is-fold' : ''}>
            <span className="who">{action.position}</span>
            <span className="what">
              {action.kind === 'fold' && '폴드'}
              {action.kind === 'check' && '체크'}
              {action.kind === 'call' && `콜 ${fmt(action.to)}bb`}
              {action.kind === 'raise' && `${fmt(action.to)}bb 레이즈`}
            </span>
          </li>
        ))}
      </ol>

      {toAct !== null ? (
        <div className="builder-turn">
          <div className="builder-who">
            <strong>{POSITION_LABELS_KO[POSITIONS_6MAX[toAct]!].full}</strong>
            <span>({POSITIONS_6MAX[toAct]}) 차례</span>
          </div>

          <div className="builder-actions">
            {actions.map((action) => {
              if (action.kind === 'raise') {
                return (
                  <div className="raise-row" key="raise">
                    <button
                      type="button"
                      className="action-button raise"
                      disabled={disabled}
                      onClick={() => onAction('raise', raiseValue)}
                    >
                      {action.label}
                    </button>
                    <input
                      className="raise-input"
                      type="number"
                      step="0.5"
                      min={action.min}
                      max={action.max}
                      value={raiseValue}
                      disabled={disabled}
                      onChange={(event) => setRaiseTo(Number(event.target.value))}
                    />
                    <span className="raise-unit">bb</span>
                  </div>
                );
              }
              return (
                <button
                  key={action.kind}
                  type="button"
                  className="action-button"
                  disabled={disabled}
                  onClick={() => onAction(action.kind)}
                >
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="builder-done">프리플롭이 끝났습니다.</p>
      )}

      <div className="builder-controls">
        <button
          type="button"
          className="link-button"
          disabled={disabled || state.actions.length === 0}
          onClick={onUndo}
        >
          한 단계 되돌리기
        </button>
        <button
          type="button"
          className="link-button"
          disabled={disabled || state.actions.length === 0}
          onClick={onReset}
        >
          처음부터
        </button>
      </div>
    </div>
  );
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
}

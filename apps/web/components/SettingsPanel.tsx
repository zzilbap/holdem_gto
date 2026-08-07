'use client';

import type { PreflopConfig } from '@holdem/solver';
import { T } from './Term';

/**
 * 설정 패널.
 *
 * 프리솔브 데이터는 6맥스 100bb 하나뿐이다. 여기서 값을 바꾸면 워커가 그 설정으로
 * 처음부터 다시 푼다. 미리 계산된 것만 보여주는 도구와 갈리는 지점이라
 * "내 스택이 애매할 때 어떻게 하지"에 답할 수 있다.
 *
 * 다만 수십 초가 걸리므로 슬라이더를 움직일 때마다 돌리지 않는다.
 * 값을 다 고른 뒤 버튼을 눌러야 시작한다.
 */

export interface SettingsPanelProps {
  draft: PreflopConfig;
  applied: PreflopConfig;
  busy: boolean;
  progress: { ratio: number; label: string } | null;
  onChange: (next: PreflopConfig) => void;
  onApply: () => void;
  onCancel: () => void;
  onReset: () => void;
}

const STACK_CHOICES = [20, 40, 60, 80, 100, 150, 200];
const OPEN_CHOICES = [2, 2.2, 2.5, 3];

export function SettingsPanel({
  draft,
  applied,
  busy,
  progress,
  onChange,
  onApply,
  onCancel,
  onReset,
}: SettingsPanelProps) {
  const dirty = !sameConfig(draft, applied);
  const openSize = draft.openSize.UTG;

  return (
    <div className="settings">
      <div className="field">
        <span className="field-label">
          <T k="stack">내 칩</T>이 얼마인가요 <em>{draft.stack}<T k="bb">bb</T></em>
        </span>
        <div className="choices">
          {STACK_CHOICES.map((stack) => (
            <button
              key={stack}
              type="button"
              className="choice"
              aria-pressed={draft.stack === stack}
              disabled={busy}
              onClick={() => onChange({ ...draft, stack })}
            >
              {stack}
            </button>
          ))}
        </div>
        <p className="field-help">
          빅블라인드의 몇 배를 들고 있는지입니다. 칩이 적을수록 프리플롭에서 과감해집니다.
        </p>
      </div>

      <div className="field">
        <span className="field-label">
          처음 <T k="open">레이즈</T>할 때 거는 돈 <em>{openSize}<T k="bb">bb</T></em>
        </span>
        <div className="choices">
          {OPEN_CHOICES.map((size) => (
            <button
              key={size}
              type="button"
              className="choice"
              aria-pressed={openSize === size}
              disabled={busy}
              onClick={() =>
                onChange({
                  ...draft,
                  openSize: {
                    ...draft.openSize,
                    UTG: size,
                    HJ: size,
                    CO: size,
                    BTN: size,
                    // SB는 뒤에 BB만 남아 조금 더 크게 연다. 관례대로 비율을 유지한다.
                    SB: Math.round(size * 1.2 * 2) / 2,
                  },
                })
              }
            >
              {size}
            </button>
          ))}
        </div>
        <p className="field-help">
          앞사람이 다 접었을 때 내가 처음 올리는 금액입니다. 온라인은 2~2.5bb, 오프라인
          라이브는 3bb 이상을 흔히 씁니다. 작게 열수록 더 많은 패로 시도할 수 있습니다.
        </p>
      </div>

      {busy ? (
        <div className="solve-status">
          <div className="progress-track">
            <div className="progress-value" style={{ width: `${(progress?.ratio ?? 0) * 100}%` }} />
          </div>
          <div className="solve-meta">
            <span>{progress?.label ?? '준비 중'}</span>
            <button type="button" className="link-button" onClick={onCancel}>
              취소
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-actions">
          <button type="button" className="primary-button" disabled={!dirty} onClick={onApply}>
            {dirty ? '이 설정으로 다시 계산' : '적용된 설정입니다'}
          </button>
          {dirty && (
            <button type="button" className="link-button" onClick={onReset}>
              되돌리기
            </button>
          )}
        </div>
      )}

      {dirty && !busy && (
        <p className="settings-note">
          바꾼 값으로 처음부터 다시 풉니다. 기기에 따라 20초쯤 걸립니다.
        </p>
      )}
    </div>
  );
}

function sameConfig(a: PreflopConfig, b: PreflopConfig): boolean {
  return (
    a.stack === b.stack &&
    a.openSize.UTG === b.openSize.UTG &&
    a.openSize.SB === b.openSize.SB &&
    a.threeBetMultiplierIP === b.threeBetMultiplierIP &&
    a.threeBetMultiplierOOP === b.threeBetMultiplierOOP &&
    a.fourBetMultiplier === b.fourBetMultiplier
  );
}

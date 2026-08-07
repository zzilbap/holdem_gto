'use client';

import { handIndexToString } from '@holdem/poker-core';
import { POSITION_LABELS_KO } from '@holdem/solver';

import { formatRelativeTime, type HistoryEntry } from '@/lib/history';
import { scenarioTitle } from '@/lib/scenario';

/**
 * 기록 탭.
 *
 * 목록에서 결론까지 바로 읽히게 만든다. 항목을 누르면 그때 보던 화면이
 * 설정까지 그대로 복원된다 — 스택이 다르면 답도 다르므로 설정을 빼면 의미가 없다.
 */

export interface HistoryPanelProps {
  entries: HistoryEntry[];
  onOpen: (entry: HistoryEntry) => void;
  onTogglePin: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

export function HistoryPanel({
  entries,
  onOpen,
  onTogglePin,
  onRemove,
  onClear,
}: HistoryPanelProps) {
  if (entries.length === 0) {
    return (
      <div className="history-empty">
        <p>아직 기록이 없습니다.</p>
        <p className="dim">
          솔버에서 상황과 패를 골라 잠깐 들여다보면 여기에 자동으로 쌓입니다.
          훑고 지나간 화면은 남기지 않습니다.
        </p>
      </div>
    );
  }

  const pinnedCount = entries.filter((entry) => entry.pinned).length;

  return (
    <div className="history">
      <div className="history-head">
        <span>
          기록 {entries.length}개
          {pinnedCount > 0 && ` · 고정 ${pinnedCount}개`}
        </span>
        <button type="button" className="link-button" onClick={onClear}>
          고정 제외하고 비우기
        </button>
      </div>

      <ul className="history-list">
        {entries.map((entry) => (
          <li key={entry.id} className={`history-item tone-${entry.tone}`}>
            <button type="button" className="history-open" onClick={() => onOpen(entry)}>
              <span className="history-row-1">
                <span className="history-hand">{handIndexToString(entry.handIndex)}</span>
                <span className="history-summary">{entry.summary}</span>
              </span>
              <span className="history-row-2">
                {POSITION_LABELS_KO[entry.hero].full}({entry.hero}) ·{' '}
                {scenarioTitle(entry.scenario)}
              </span>
              <span className="history-row-3">
                {entry.config.stack}bb · 오픈 {entry.config.openSize.UTG}bb ·{' '}
                {formatRelativeTime(entry.viewedAt)}
              </span>
            </button>

            <div className="history-actions">
              <button
                type="button"
                className={`icon-button${entry.pinned ? ' active' : ''}`}
                title={entry.pinned ? '고정 해제' : '고정하기'}
                aria-label={entry.pinned ? '고정 해제' : '고정하기'}
                onClick={() => onTogglePin(entry.id)}
              >
                {entry.pinned ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="icon-button"
                title="삭제"
                aria-label="삭제"
                onClick={() => onRemove(entry.id)}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

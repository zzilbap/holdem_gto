'use client';

import { handIndexToString, handStringToIndex } from '@holdem/poker-core';
import type { Position } from '@holdem/solver';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { FlopPanel } from '@/components/FlopPanel';
import { HandGrid } from '@/components/HandGrid';
import { HistoryPanel } from '@/components/HistoryPanel';
import { SeatPicker } from '@/components/SeatPicker';
import { SettingsPanel } from '@/components/SettingsPanel';
import { T } from '@/components/Term';
import { Verdict } from '@/components/Verdict';
import type { HistoryEntry } from '@/lib/history';
import { useFlop } from '@/lib/use-flop';
import { useHistory } from '@/lib/use-history';
import { usePreflop } from '@/lib/use-preflop';
import {
  describeScenario,
  getAdvice,
  listScenariosFor,
  scenarioId,
  scenarioTitle,
  type Scenario,
} from '@/lib/scenario';

type Tab = 'solver' | 'flop' | 'history';

export default function Page() {
  const preflop = usePreflop();
  const { data, error } = preflop;

  const [tab, setTab] = useState<Tab>('solver');
  const [hero, setHero] = useState<Position>('BTN');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [handIndex, setHandIndex] = useState<number>(() => handStringToIndex('AKo'));

  /** 기록에서 복원할 때, 자리를 먼저 바꾼 뒤 다음 렌더에서 상황을 맞춘다. */
  const [pendingScenario, setPendingScenario] = useState<string | null>(null);
  /** 복원한 기록의 설정이 지금과 달라 다시 계산이 필요한 경우 안내한다. */
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  const scenarios = useMemo(() => listScenariosFor(hero), [hero]);

  // 자리를 바꾸면 이전 상황이 그대로 유효하지 않다. 첫 항목으로 되돌린다.
  useEffect(() => {
    setScenarioIndex(0);
  }, [hero]);

  // 위 effect가 0으로 되돌린 뒤에 실행되어야 하므로 선언 순서가 중요하다.
  useEffect(() => {
    if (!pendingScenario) return;
    const index = scenarios.findIndex((item) => scenarioId(item) === pendingScenario);
    if (index >= 0) setScenarioIndex(index);
    setPendingScenario(null);
  }, [pendingScenario, scenarios]);

  const scenario: Scenario | undefined = scenarios[scenarioIndex] ?? scenarios[0];

  const advice = useMemo(
    () => (data && scenario ? getAdvice(data, scenario, handIndex) : null),
    [data, scenario, handIndex],
  );

  const history = useHistory(
    { hero, scenario, handIndex, config: data?.config ?? null, advice },
    tab === 'solver' && !preflop.busy,
  );

  const flop = useFlop(data);

  const fills = useMemo(() => {
    if (!data || !scenario) return undefined;
    return (index: number) => {
      const result = getAdvice(data, scenario, index);
      // 도달하지 않는 패는 색을 칠하지 않는다. 회색 칸이 곧 "여긴 볼 일 없음"이다.
      if (!result || result.unreachable) return null;
      return result.options;
    };
  }, [data, scenario]);

  const openHistoryEntry = useCallback(
    (entry: HistoryEntry) => {
      setHero(entry.hero);
      setHandIndex(entry.handIndex);
      setPendingScenario(scenarioId(entry.scenario));
      setTab('solver');

      const current = data?.config;
      const sameSetup =
        current &&
        current.stack === entry.config.stack &&
        current.openSize.UTG === entry.config.openSize.UTG;

      if (!sameSetup) {
        // 설정이 다르면 답도 다르다. 자동으로 재계산하면 수십 초가 걸리므로 사용자가 정하게 둔다.
        preflop.setDraft(entry.config);
        setRestoreNote(
          `이 기록은 ${entry.config.stack}bb · 오픈 ${entry.config.openSize.UTG}bb 설정에서 본 것입니다. ` +
            `지금 화면은 ${current?.stack}bb 기준이라 답이 다를 수 있어요. ` +
            `왼쪽 설정에서 "이 설정으로 다시 계산"을 누르면 그때 상태로 맞춰집니다.`,
        );
      } else {
        setRestoreNote(null);
      }
    },
    [data, preflop],
  );

  return (
    <div className="app">
      <header className="topbar">
        <h1>홀덤 GTO</h1>
        <div className="tabs" role="tablist">
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={tab === 'solver'}
            onClick={() => setTab('solver')}
          >
            솔버
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={tab === 'flop'}
            onClick={() => setTab('flop')}
          >
            플롭
          </button>
          <button
            type="button"
            className="tab"
            role="tab"
            aria-selected={tab === 'history'}
            onClick={() => setTab('history')}
          >
            기록
            {history.entries.length > 0 && (
              <span className="count">{history.entries.length}</span>
            )}
          </button>
        </div>
        <span className="spacer" />
        {data && (
          <span className="meta">
            6맥스 · {data.config.stack}bb · 스팟 {data.spots.size}개
            {preflop.isCustom && <span className="custom-badge">직접 계산</span>}
          </span>
        )}
      </header>

      <div className="body">
        {error && <div className="centered error">문제가 생겼습니다: {error}</div>}
        {!data && !error && <div className="centered">전략 데이터를 불러오는 중…</div>}

        {data && tab === 'flop' && (
          <FlopPanel
            flop={flop}
            onRequestResolve={(config) => {
              // 플롭 탭에서 넣은 금액으로 프리플롭부터 다시 푼다.
              // 계산은 솔버 탭의 워커가 하므로 그쪽으로 넘기고 화면도 옮긴다.
              preflop.setDraft(config);
              preflop.apply();
              setTab('solver');
            }}
          />
        )}

        {data && scenario && tab === 'history' && (
          <div className="history-page">
            <HistoryPanel
              entries={history.entries}
              onOpen={openHistoryEntry}
              onTogglePin={history.togglePin}
              onRemove={history.remove}
              onClear={history.clear}
            />
          </div>
        )}

        {data && scenario && tab === 'solver' && (
          <>
            <aside className="sidebar">
              <div className="control-group">
                <div className="control-head">
                  <span className="step">1</span>
                  <h2>내 자리</h2>
                </div>
                <SeatPicker value={hero} onChange={setHero} />
              </div>

              <div className="control-group">
                <div className="control-head">
                  <span className="step">2</span>
                  <h2>지금 상황</h2>
                </div>
                <div className="scenario-list" role="group" aria-label="상황 선택">
                  {scenarios.map((item, index) => (
                    <button
                      key={scenarioId(item)}
                      type="button"
                      className="scenario-chip"
                      aria-pressed={index === scenarioIndex}
                      onClick={() => setScenarioIndex(index)}
                    >
                      {scenarioTitle(item)}
                    </button>
                  ))}
                </div>
              </div>

              {preflop.draft && preflop.applied && (
                <div className="control-group">
                  <div className="control-head">
                    <span className="step">＋</span>
                    <h2>설정 바꾸기</h2>
                  </div>
                  <SettingsPanel
                    draft={preflop.draft}
                    applied={preflop.applied}
                    busy={preflop.busy}
                    progress={
                      preflop.progress
                        ? { ratio: preflop.progress.ratio, label: preflop.progress.label }
                        : null
                    }
                    onChange={preflop.setDraft}
                    onApply={() => {
                      setRestoreNote(null);
                      preflop.apply();
                    }}
                    onCancel={preflop.cancel}
                    onReset={preflop.reset}
                  />
                </div>
              )}
            </aside>

            <main className="main">
              {restoreNote && <p className="restore-note">{restoreNote}</p>}
              <div className="situation">
                {describeScenario(scenario, data.config)}
                {/* bb가 문장 안에서 처음 등장한다. 뜻을 모르면 문장 전체가 안 읽힌다. */}
                <span className="situation-note">
                  <T k="bb">bb</T> = 빅블라인드 1개. 블라인드가 500/1000원인 판이면 1bb는
                  1,000원입니다.
                </span>
              </div>

              <div className="workspace">
                <div className="grid-column">
                  <div className="grid-shell">
                    <HandGrid selected={handIndex} onSelect={setHandIndex} fills={fills} />
                    <div className="legend">
                      <span>
                        <i style={{ background: 'var(--raise)' }} />
                        레이즈
                      </span>
                      <span>
                        <i style={{ background: 'var(--allin)' }} />
                        올인
                      </span>
                      <span>
                        <i style={{ background: 'var(--call)' }} />
                        콜
                      </span>
                      <span>
                        <i style={{ background: 'var(--fold)' }} />
                        폴드
                      </span>
                      <span>
                        <i
                          style={{
                            background: 'var(--bg-sunken)',
                            border: '1px solid var(--border-strong)',
                          }}
                        />
                        해당 없음
                      </span>
                    </div>
                  </div>
                </div>

                <div className="verdict-column">
                  {advice ? (
                    <Verdict advice={advice} handIndex={handIndex} />
                  ) : (
                    <div className="verdict">이 상황의 데이터가 아직 없습니다.</div>
                  )}

                  <details className="advanced">
                    <summary>표 읽는 법과 계산 정보</summary>
                    <div className="advanced-body">
                      칸 하나가 패 하나입니다. 칸 안의 색 비율이 그 패를 어떻게 나눠 치는지를
                      뜻합니다. 왼쪽 위가 가장 강한 AA, 오른쪽 위는{' '}
                      <T k="suited">무늬가 같은 패(s)</T>, 왼쪽 아래는 무늬가 다른 패(o)입니다.
                      회색 칸은 이 상황에서 나올 일이 없는 패입니다.
                      <div className="stat-grid">
                        <div className="stat">
                          <div className="k">현재 패</div>
                          <div className="v">{handIndexToString(handIndex)}</div>
                        </div>
                        <div className="stat">
                          <div className="k">
                            <T k="stack">스택</T>
                          </div>
                          <div className="v">{data.config.stack}bb</div>
                        </div>
                        <div className="stat">
                          <div className="k">
                            <T k="openSize">오픈 크기</T>
                          </div>
                          <div className="v">{data.config.openSize.UTG}bb</div>
                        </div>
                        <div className="stat">
                          <div className="k">
                            <T k="convergence">수렴 지표</T>
                          </div>
                          <div className="v">{data.meta.drift.toFixed(4)}</div>
                        </div>
                      </div>
                      <p style={{ marginBottom: 0 }}>
                        {preflop.isCustom ? (
                          <>
                            바꾼 설정으로 이 브라우저에서 직접 계산했습니다
                            {preflop.lastElapsedMs !== null &&
                              ` (${(preflop.lastElapsedMs / 1000).toFixed(1)}초)`}
                            . 기본 설정은 미리 더 오래 계산해 둔 것이라 조금 더 정밀합니다.
                          </>
                        ) : (
                          <>
                            전략은 CFR로 직접 계산했습니다. 스팟 {data.spots.size}개를{' '}
                            {data.meta.rounds}번 왕복하며 서로 맞췄고, 수렴 지표가 0에 가까울수록
                            답이 안정적이라는 뜻입니다.
                          </>
                        )}
                      </p>
                      <p className="accuracy-note">
                        플롭 이후의 가치는 아직 근사식으로 잡고 있어서, 널리 쓰이는 해법보다
                        전반적으로 조금 느슨하게(넓게 참여하는 쪽으로) 나옵니다. 어떤 패를
                        치고 접을지의 큰 그림은 맞지만, 경계에 있는 패는 실제보다 후하게
                        평가될 수 있습니다. 플롭 솔버가 붙으면 이 근사가 사라집니다.
                      </p>
                    </div>
                  </details>
                </div>
              </div>
            </main>
          </>
        )}
      </div>
    </div>
  );
}

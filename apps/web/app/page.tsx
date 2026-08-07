'use client';

import { handIndexToString, handStringToIndex } from '@holdem/poker-core';
import type { Position } from '@holdem/solver';
import { useEffect, useMemo, useState } from 'react';

import { HandGrid } from '@/components/HandGrid';
import { SeatPicker } from '@/components/SeatPicker';
import { SettingsPanel } from '@/components/SettingsPanel';
import { Verdict } from '@/components/Verdict';
import { usePreflop } from '@/lib/use-preflop';
import {
  describeScenario,
  getAdvice,
  listScenariosFor,
  scenarioId,
  scenarioTitle,
  type Scenario,
} from '@/lib/scenario';

export default function Page() {
  const preflop = usePreflop();
  const { data, error } = preflop;

  const [hero, setHero] = useState<Position>('BTN');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [handIndex, setHandIndex] = useState<number>(() => handStringToIndex('AKo'));

  const scenarios = useMemo(() => listScenariosFor(hero), [hero]);

  // 자리를 바꾸면 이전 상황이 그대로 유효하지 않다. 첫 항목으로 되돌린다.
  useEffect(() => {
    setScenarioIndex(0);
  }, [hero]);

  const scenario: Scenario | undefined = scenarios[scenarioIndex] ?? scenarios[0];

  const advice = useMemo(
    () => (data && scenario ? getAdvice(data, scenario, handIndex) : null),
    [data, scenario, handIndex],
  );

  const fills = useMemo(() => {
    if (!data || !scenario) return undefined;
    return (index: number) => {
      const result = getAdvice(data, scenario, index);
      // 도달하지 않는 패는 색을 칠하지 않는다. 회색 칸이 곧 "여긴 볼 일 없음"이다.
      if (!result || result.unreachable) return null;
      return result.options;
    };
  }, [data, scenario]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>홀덤 GTO</h1>
        <p className="tagline">상황을 고르면 뭘 해야 하는지 한 줄로 알려줍니다</p>
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

        {data && scenario && (
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
                    onApply={preflop.apply}
                    onCancel={preflop.cancel}
                    onReset={preflop.reset}
                  />
                </div>
              )}
            </aside>

            <main className="main">
              <p className="situation">{describeScenario(scenario, data.config)}</p>

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
                      뜻합니다. 왼쪽 위가 가장 강한 AA, 오른쪽 위는 무늬가 같은 패(s), 왼쪽
                      아래는 무늬가 다른 패(o)입니다. 회색 칸은 이 상황에서 나올 일이 없는
                      패입니다.
                      <div className="stat-grid">
                        <div className="stat">
                          <div className="k">현재 패</div>
                          <div className="v">{handIndexToString(handIndex)}</div>
                        </div>
                        <div className="stat">
                          <div className="k">스택</div>
                          <div className="v">{data.config.stack}bb</div>
                        </div>
                        <div className="stat">
                          <div className="k">오픈 크기</div>
                          <div className="v">{data.config.openSize.UTG}bb</div>
                        </div>
                        <div className="stat">
                          <div className="k">수렴 지표</div>
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

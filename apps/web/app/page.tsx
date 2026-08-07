'use client';

import { handIndexToString, handStringToIndex } from '@holdem/poker-core';
import type { Position } from '@holdem/solver';
import { useEffect, useMemo, useState } from 'react';

import { HandGrid } from '@/components/HandGrid';
import { SeatPicker } from '@/components/SeatPicker';
import { Verdict } from '@/components/Verdict';
import { loadPreflopData, type PreflopData } from '@/lib/preflop-data';
import {
  describeScenario,
  getAdvice,
  listScenariosFor,
  scenarioId,
  scenarioTitle,
  type Scenario,
} from '@/lib/scenario';

export default function Page() {
  const [data, setData] = useState<PreflopData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [hero, setHero] = useState<Position>('BTN');
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [handIndex, setHandIndex] = useState<number>(() => handStringToIndex('AKo'));

  useEffect(() => {
    loadPreflopData()
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

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
          </span>
        )}
      </header>

      <div className="body">
        {error && <div className="centered error">데이터를 불러오지 못했습니다: {error}</div>}
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
                        <i style={{ background: 'var(--bg-sunken)', border: '1px solid var(--border-strong)' }} />
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
                          <div className="k">에퀴티 표본</div>
                          <div className="v">{(data.meta.boardSamples / 1000).toFixed(0)}k보드</div>
                        </div>
                        <div className="stat">
                          <div className="k">수렴 지표</div>
                          <div className="v">{data.meta.drift.toFixed(4)}</div>
                        </div>
                      </div>
                      <p style={{ marginBottom: 0 }}>
                        전략은 CFR로 직접 계산했습니다. 스팟 {data.spots.size}개를{' '}
                        {data.meta.rounds}번 왕복하며 서로 맞췄고, 수렴 지표가 0에 가까울수록
                        답이 안정적이라는 뜻입니다.
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

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

  const advice = useMemo(() => {
    if (!data || !scenario) return null;
    return getAdvice(data, scenario, handIndex);
  }, [data, scenario, handIndex]);

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
    <div className="shell">
      <header className="masthead">
        <h1>홀덤 GTO — 초보자용</h1>
        <p>상황을 고르면 뭘 해야 하는지 한 줄로 알려줍니다. 어려운 표는 아래에 접어뒀어요.</p>
      </header>

      {error && <div className="error">데이터를 불러오지 못했습니다: {error}</div>}
      {!data && !error && <div className="loading">전략 데이터를 불러오는 중…</div>}

      {data && scenario && (
        <>
          <section className="section">
            <div className="section-label">
              <span className="step">1</span>
              <h2>내 자리</h2>
              <span className="hint">뒤에 사람이 적을수록 유리한 자리입니다</span>
            </div>
            <div className="panel">
              <SeatPicker value={hero} onChange={setHero} />
            </div>
          </section>

          <section className="section">
            <div className="section-label">
              <span className="step">2</span>
              <h2>지금 상황</h2>
              <span className="hint">내 차례가 오기까지 무슨 일이 있었나요?</span>
            </div>
            <div className="panel">
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
              <p className="situation">{describeScenario(scenario, data.config)}</p>
            </div>
          </section>

          <section className="section">
            <div className="section-label">
              <span className="step">3</span>
              <h2>내 패</h2>
              <span className="hint">
                {handIndexToString(handIndex)} 선택됨 · s는 무늬 같음, o는 무늬 다름
              </span>
            </div>
            <div className="panel">
              <HandGrid selected={handIndex} onSelect={setHandIndex} fills={fills} />
            </div>
          </section>

          <section className="section">
            <div className="section-label">
              <span className="step">4</span>
              <h2>이렇게 하세요</h2>
            </div>
            {advice ? (
              <Verdict advice={advice} handIndex={handIndex} />
            ) : (
              <div className="panel">이 상황의 데이터가 아직 없습니다.</div>
            )}
          </section>

          <details className="advanced">
            <summary>자세히 보기 — 레인지 표와 계산 정보</summary>
            <div className="advanced-body">
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
                  <i style={{ background: 'var(--check)' }} />
                  체크
                </span>
                <span>
                  <i style={{ background: 'var(--fold)' }} />
                  폴드
                </span>
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--text-dim)', marginTop: 0 }}>
                위 표에서 칸 하나가 패 하나입니다. 칸 안의 색 비율이 곧 그 패를 어떻게 나눠
                치는지를 뜻합니다. 왼쪽 위가 가장 강한 AA, 오른쪽 위는 무늬가 같은 패,
                왼쪽 아래는 무늬가 다른 패입니다.
              </p>

              <div className="stat-grid">
                <div className="stat">
                  <div className="k">이 상황</div>
                  <div className="v" style={{ fontSize: 14 }}>
                    {scenarioTitle(scenario)}
                  </div>
                </div>
                <div className="stat">
                  <div className="k">스택</div>
                  <div className="v">{data.config.stack}bb</div>
                </div>
                <div className="stat">
                  <div className="k">에퀴티 표본</div>
                  <div className="v">{data.meta.boardSamples.toLocaleString()}보드</div>
                </div>
                <div className="stat">
                  <div className="k">수렴 지표</div>
                  <div className="v">{data.meta.drift.toFixed(4)}</div>
                </div>
              </div>
            </div>
          </details>

          <p className="footnote">
            6맥스 {data.config.stack}bb 캐시게임 기준입니다. 오픈 사이즈는 앞자리{' '}
            {data.config.openSize.UTG}bb, 스몰블라인드 {data.config.openSize.SB}bb를 씁니다.
            <br />
            전략은 CFR로 직접 계산했고, 스팟 {data.spots.size}개를 {data.meta.rounds}번 왕복하며
            서로 맞췄습니다. 수렴 지표가 0에 가까울수록 답이 안정적이라는 뜻입니다.
            <br />
            생성 시각 <code>{new Date(data.generatedAt).toLocaleString('ko-KR')}</code>
          </p>
        </>
      )}
    </div>
  );
}

'use client';

import { POSITIONS_6MAX, POSITION_LABELS_KO, type Position } from '@holdem/solver';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PokerTable } from '@/components/PokerTable';
import type { PreflopData } from '@/lib/preflop-data';
import { describeScenario } from '@/lib/scenario';
import {
  ALL_SCENARIO_KINDS,
  EMPTY_STATS,
  accuracyOf,
  applyResult,
  gradeAnswer,
  generateQuestion,
  questionTitle,
  type TrainerFilter,
  type TrainerQuestion,
  type TrainerResult,
} from '@/lib/trainer';

/**
 * 연습 탭.
 *
 * 상황과 패가 주어지고 액션을 고르면 바로 채점한다. 화면을 보고 배우는 것과
 * 직접 골라보고 틀려보는 건 학습 효과가 다르다 — 후자가 훨씬 오래 남는다.
 *
 * 답을 고르기 전에는 정답을 절대 보여주지 않는다. 미리 보이면 연습이 아니다.
 */
export function TrainerPanel({ data }: { data: PreflopData }) {
  const [filter, setFilter] = useState<TrainerFilter>({ positions: [], kinds: [] });
  const [question, setQuestion] = useState<TrainerQuestion | null>(null);
  const [result, setResult] = useState<TrainerResult | null>(null);
  const [stats, setStats] = useState(EMPTY_STATS);

  const next = useCallback(() => {
    setResult(null);
    setQuestion(generateQuestion(data, filter));
  }, [data, filter]);

  // 첫 문제, 그리고 조건이 바뀌면 새 문제.
  useEffect(() => {
    setResult(null);
    setQuestion(generateQuestion(data, filter));
  }, [data, filter]);

  const answer = useCallback(
    (kind: string) => {
      if (!question || result) return;
      const graded = gradeAnswer(question, kind);
      setResult(graded);
      setStats((current) => applyResult(current, graded.grade));
    },
    [question, result],
  );

  // 답을 고른 뒤 스페이스/엔터로 바로 다음 문제. 연습은 리듬이 중요하다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!result) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        next();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, next]);

  const tableProps = useMemo(() => {
    if (!question) return null;
    return describeTable(question, data);
  }, [question, data]);

  return (
    <div className="trainer-page">
      <aside className="trainer-controls">
        <div className="control-group">
          <div className="control-head">
            <span className="step">1</span>
            <h2>어떤 자리를 연습할까요</h2>
          </div>
          <div className="seat-row">
            {POSITIONS_6MAX.map((position) => (
              <button
                key={position}
                type="button"
                className="seat"
                aria-pressed={filter.positions.includes(position)}
                onClick={() => setFilter((f) => ({ ...f, positions: toggle(f.positions, position) }))}
              >
                <span className="code">{position}</span>
                <span className="name">{POSITION_LABELS_KO[position].full}</span>
              </button>
            ))}
          </div>
          <p className="field-help">
            {filter.positions.length === 0 ? '아무것도 안 고르면 전체가 나옵니다.' : '고른 자리만 나옵니다.'}
          </p>
        </div>

        <div className="control-group">
          <div className="control-head">
            <span className="step">2</span>
            <h2>어떤 상황을 연습할까요</h2>
          </div>
          <div className="scenario-list">
            {ALL_SCENARIO_KINDS.map(({ kind, label }) => (
              <button
                key={kind}
                type="button"
                className="scenario-chip"
                aria-pressed={filter.kinds.includes(kind)}
                onClick={() => setFilter((f) => ({ ...f, kinds: toggle(f.kinds, kind) }))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <div className="control-head">
            <span className="step">＝</span>
            <h2>성적</h2>
          </div>
          <div className="stat-grid">
            <div className="stat">
              <div className="k">푼 문제</div>
              <div className="v">{stats.answered}</div>
            </div>
            <div className="stat">
              <div className="k">정확도</div>
              <div className="v">{stats.answered > 0 ? `${accuracyOf(stats).toFixed(0)}%` : '—'}</div>
            </div>
            <div className="stat">
              <div className="k">연속</div>
              <div className="v">{stats.streak}</div>
            </div>
            <div className="stat">
              <div className="k">최고 연속</div>
              <div className="v">{stats.bestStreak}</div>
            </div>
          </div>
          {stats.answered > 0 && (
            <p className="field-help">
              주된 선택 {stats.best} · 섞어 치는 쪽 {stats.mixed} · 해법에 없는 선택 {stats.wrong}
            </p>
          )}
          {stats.answered > 0 && (
            <button type="button" className="link-button" onClick={() => setStats(EMPTY_STATS)}>
              성적 초기화
            </button>
          )}
        </div>
      </aside>

      <main className="trainer-main">
        {!question ? (
          <div className="centered">
            고른 조건에 맞는 문제가 없습니다. 자리나 상황을 더 넓게 골라주세요.
          </div>
        ) : (
          <>
            <p className="situation">{describeScenario(question.scenario, data.config)}</p>

            {tableProps && <PokerTable {...tableProps} cards={question.cards} />}

            <div className="trainer-actions">
              {question.options.map((option) => {
                const isChosen = result?.chosen.kind === option.kind;
                const isBest = result?.best.kind === option.kind;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    className={
                      'trainer-button' +
                      (result ? ' revealed' : '') +
                      (isChosen ? ' chosen' : '') +
                      (result && isBest ? ' best' : '')
                    }
                    disabled={!!result}
                    onClick={() => answer(option.kind)}
                  >
                    <span className="label">{option.name}</span>
                    <span className="sub">{option.detail}</span>
                    {result && (
                      <span className="freq">{Math.round(option.frequency * 100)}%</span>
                    )}
                  </button>
                );
              })}
            </div>

            {result && (
              <div className={`trainer-feedback grade-${result.grade}`}>
                <div className="feedback-head">
                  <strong>{result.headline}</strong>
                  <span className="feedback-spot">{questionTitle(result.question)}</span>
                </div>
                <p>{result.detail}</p>
                <button type="button" className="primary-button" onClick={next} autoFocus>
                  다음 문제 <span className="key-hint">Space</span>
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/** 문제의 시나리오를 테이블 그림에 필요한 정보로 바꾼다. */
function describeTable(question: TrainerQuestion, data: PreflopData) {
  const { scenario } = question;
  const config = data.config;
  const heroIndex = POSITIONS_6MAX.indexOf(scenario.hero);
  const blinds = config.smallBlind + config.bigBlind;

  if (scenario.kind === 'open') {
    return {
      hero: scenario.hero,
      // 앞자리는 전부 접힌 상태다.
      folded: POSITIONS_6MAX.slice(0, heroIndex),
      aggressor: null,
      pot: blinds,
    };
  }

  const villain = scenario.villain;
  const villainIndex = POSITIONS_6MAX.indexOf(villain);

  if (scenario.kind === 'vs-open') {
    const amount = config.openSize[villain];
    return {
      hero: scenario.hero,
      folded: POSITIONS_6MAX.filter(
        (_, index) => index < heroIndex && index !== villainIndex,
      ),
      aggressor: { position: villain, amount },
      pot: blinds + amount,
    };
  }

  // vs-3bet / vs-4bet — 상대가 올린 금액을 대략 표시한다.
  const openTo = config.openSize[scenario.kind === 'vs-3bet' ? scenario.hero : villain];
  const threeBet = openTo * config.threeBetMultiplierIP;
  const amount = scenario.kind === 'vs-3bet' ? threeBet : threeBet * config.fourBetMultiplier;
  return {
    hero: scenario.hero,
    folded: POSITIONS_6MAX.filter(
      (position, index) =>
        position !== scenario.hero && position !== villain && index < Math.max(heroIndex, villainIndex),
    ),
    aggressor: { position: villain, amount: Math.round(amount * 2) / 2 },
    pot: Math.round((blinds + amount + openTo) * 2) / 2,
  };
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

'use client';

import { RANKS, SUITS, comboToHandIndex } from '@holdem/poker-core';
import { POSITION_LABELS_KO, type Position } from '@holdem/solver';
import { useMemo, useState } from 'react';

import { HandGrid } from '@/components/HandGrid';
import { describeLine, gridOptions, handAdvice } from '@/lib/flop-advice';
import { potTypeLabel, type FlopLine, type PotType } from '@/lib/flop-setup';
import { walkLine, type FlopState } from '@/lib/use-flop';

/**
 * 플롭 화면.
 *
 * 프리플롭과 다른 점 두 가지를 UI가 감당해야 한다.
 *  1. 미리 계산해 둘 수 없어서 볼 때마다 몇 초를 기다린다 → 두 단계 진행 표시
 *  2. 액션이 한 번으로 안 끝난다(체크→벳→레이즈…) → 경로를 눌러 내려가는 방식
 */

const SUIT_LABEL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** 팟 종류별로 묶어 드롭다운에 optgroup으로 넣는다. 45개를 평평하게 두면 못 찾는다. */
function groupLines(lines: FlopLine[]): Array<[PotType, FlopLine[]]> {
  const order: PotType[] = ['srp', '3bet', '4bet'];
  return order
    .map((type) => [type, lines.filter((line) => line.potType === type)] as [PotType, FlopLine[]])
    .filter(([, group]) => group.length > 0);
}

export function FlopPanel({ flop }: { flop: FlopState }) {
  const [selectedHand, setSelectedHand] = useState<number | null>(null);

  const current = useMemo(() => {
    if (!flop.solution) return null;
    return walkLine(flop.solution.tree, flop.line);
  }, [flop.solution, flop.line]);

  const node = current?.node;
  const actionNode = node?.kind === 'action' ? node : null;

  const fills = useMemo(() => {
    if (!flop.solution || !actionNode) return undefined;
    return gridOptions(flop.solution, actionNode);
  }, [flop.solution, actionNode]);

  const advice = useMemo(() => {
    if (!flop.solution || !actionNode || selectedHand === null) return null;
    // 매트릭스 칸(169)에서 콤보 하나를 골라 그 콤보의 답을 보여준다.
    const combos = flop.solution.combos[actionNode.player];
    for (let i = 0; i < combos.length; i++) {
      if (comboToHandIndex(combos[i]!) === selectedHand) {
        return handAdvice(flop.solution, actionNode, i);
      }
    }
    return null;
  }, [flop.solution, actionNode, selectedHand]);

  return (
    <div className="flop-page">
      <div className="flop-controls">
        <div className="control-group">
          <div className="control-head">
            <span className="step">1</span>
            <h2>어떤 상황에서 플롭에 왔나요</h2>
          </div>
          <select
            className="select"
            value={flop.selectedLineId ?? ''}
            onChange={(event) => flop.selectLine(event.target.value)}
          >
            {groupLines(flop.lines).map(([type, lines]) => (
              <optgroup key={type} label={potTypeLabel(type)}>
                {lines.map((line) => (
                  <option key={line.id} value={line.id}>
                    {line.actionText}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {flop.setup && (
            <p className="field-help">
              팟 {flop.setup.pot}bb · 남은 칩 {flop.setup.effectiveStack}bb ·{' '}
              {POSITION_LABELS_KO[flop.setup.oop].full}가 먼저 행동
            </p>
          )}
          <p className="field-help multiway-note">
            세 명 이상이 보는 팟은 아직 없습니다. 솔버가 2인 전용이라 그렇고,
            사이드팟과 3자 쇼다운을 다루려면 엔진을 새로 짜야 합니다.
          </p>
        </div>

        <div className="control-group">
          <div className="control-head">
            <span className="step">2</span>
            <h2>플롭 카드 3장</h2>
          </div>
          <div className="board-input">
            <input
              className="text-input"
              value={flop.boardText}
              onChange={(event) => flop.setBoardText(event.target.value)}
              placeholder="Kh8d3c"
              spellCheck={false}
            />
            <button type="button" className="link-button" onClick={flop.randomBoard}>
              무작위
            </button>
          </div>
          {flop.board.length === 3 ? (
            <div className="board-cards">
              {flop.board.map((card) => (
                <span key={card} className={`card suit-${SUITS[card & 3]}`}>
                  {RANKS[card >> 2]}
                  {SUIT_LABEL[SUITS[card & 3]!]}
                </span>
              ))}
            </div>
          ) : (
            <p className="field-help">
              카드 3장을 적어주세요. 예: Kh8d3c (K하트, 8다이아, 3클럽)
            </p>
          )}
        </div>

        {flop.setup && (
          <div className="control-group">
            <div className="control-head">
              <span className="step">3</span>
              <h2>계산하기</h2>
            </div>
            {flop.busy ? (
              <div className="solve-status">
                <div className="progress-track">
                  <div
                    className="progress-value"
                    style={{ width: `${(flop.progress?.ratio ?? 0) * 100}%` }}
                  />
                </div>
                <div className="solve-meta">
                  <span>
                    {flop.progress?.phase === 'equity' ? '승률 계산 중' : '전략 계산 중'}
                  </span>
                  <button type="button" className="link-button" onClick={flop.cancel}>
                    취소
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="primary-button"
                  disabled={flop.board.length !== 3}
                  onClick={flop.solve}
                >
                  이 플롭 풀기
                </button>
                <p className="field-help">
                  플롭은 미리 계산해 둘 수 없어서 볼 때마다 풉니다. 몇 초 걸립니다.
                </p>
              </>
            )}
            {flop.error && <p className="flop-error">{flop.error}</p>}
          </div>
        )}
      </div>

      <div className="flop-main">
        {!flop.solution && !flop.busy && (
          <div className="centered">
            왼쪽에서 상황과 플롭을 고르고 <strong>이 플롭 풀기</strong>를 눌러주세요.
          </div>
        )}

        {flop.solution && current && (
          <>
            <div className="situation">
              {'actionText' in flop.solution.setup
                ? (flop.solution.setup as FlopLine).actionText
                : flop.solution.setup.label}
              . 둘이서 플롭을 봤습니다. 팟 {flop.solution.setup.pot}bb, 남은 칩{' '}
              {flop.solution.setup.effectiveStack}bb.
              <span className="situation-note">
                {POSITION_LABELS_KO[flop.solution.setup.oop].full}가 먼저 행동합니다 ·{' '}
                지금 보는 지점: {describeLine(flop.solution.tree, flop.line)}
              </span>
            </div>

            <div className="line-bar">
              <button
                type="button"
                className="line-chip"
                onClick={() => flop.popTo(0)}
                aria-pressed={flop.line.length === 0}
              >
                처음부터
              </button>
              {current.path.map((step, depth) => (
                <button
                  key={depth}
                  type="button"
                  className="line-chip"
                  onClick={() => flop.popTo(depth + 1)}
                  aria-pressed={depth === current.path.length - 1}
                >
                  {step.node.actions[step.chosen]!.label}
                </button>
              ))}
            </div>

            {actionNode ? (
              <>
                <div className="turn-notice">
                  지금은{' '}
                  <strong>
                    {POSITION_LABELS_KO[
                      actionNode.player === 0
                        ? flop.solution.setup.oop
                        : flop.solution.setup.ip
                    ].full}
                  </strong>
                  의 차례입니다. 다음 행동을 눌러 그 뒤 상황도 볼 수 있어요.
                </div>

                <div className="action-buttons">
                  {actionNode.actions.map((action, index) => (
                    <button
                      key={index}
                      type="button"
                      className="action-button"
                      onClick={() => flop.pushAction(index)}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>

                <div className="flop-workspace">
                  <div className="grid-shell">
                    <HandGrid
                      selected={selectedHand}
                      onSelect={setSelectedHand}
                      fills={fills}
                    />
                    <div className="legend">
                      <span>
                        <i style={{ background: 'var(--raise)' }} />벳·레이즈
                      </span>
                      <span>
                        <i style={{ background: 'var(--allin)' }} />
                        올인
                      </span>
                      <span>
                        <i style={{ background: 'var(--call)' }} />콜
                      </span>
                      <span>
                        <i style={{ background: 'var(--check)' }} />체크
                      </span>
                      <span>
                        <i style={{ background: 'var(--fold)' }} />폴드
                      </span>
                    </div>
                  </div>

                  <div className="verdict-column">
                    {advice ? (
                      <div className={`verdict tone-${advice.primary.kind}`}>
                        <span className="hand-badge">{advice.comboLabel}</span>
                        <h3>{advice.headline}</h3>
                        <p className="subline">{advice.subline}</p>
                        <div className="bars">
                          {advice.options.map((option) => (
                            <div className="bar-row" key={option.detail}>
                              <span className="who">{option.name}</span>
                              <span className="track">
                                <span
                                  className="value"
                                  style={{
                                    width: `${Math.round(option.frequency * 100)}%`,
                                    background: `var(--${option.kind})`,
                                  }}
                                />
                              </span>
                              <span className="pct">{Math.round(option.frequency * 100)}%</span>
                            </div>
                          ))}
                        </div>
                        <p className="reason">
                          이 패의 기댓값은 {advice.ev.toFixed(2)}bb입니다.
                          {advice.comboVaries && (
                            <>
                              {' '}
                              같은 {advice.comboLabel}라도 <strong>무늬에 따라 답이 다릅니다</strong> —
                              보드와 무늬가 맞물리면 플러시를 노릴 수 있기 때문입니다.
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      <div className="verdict">
                        표에서 패를 하나 골라보세요. 회색 칸은 이 상황에서 나올 수 없는 패입니다.
                      </div>
                    )}

                    <div className="stat-grid">
                      <div className="stat">
                        <div className="k">앞사람 레인지</div>
                        <div className="v">{flop.solution.setup.oopWidth.toFixed(0)}%</div>
                      </div>
                      <div className="stat">
                        <div className="k">뒷사람 레인지</div>
                        <div className="v">{flop.solution.setup.ipWidth.toFixed(0)}%</div>
                      </div>
                      <div className="stat">
                        <div className="k">앞사람 기댓값</div>
                        <div className="v">{flop.solution.meanEv[0].toFixed(2)}bb</div>
                      </div>
                      <div className="stat">
                        <div className="k">계산 시간</div>
                        <div className="v">{(flop.solution.elapsedMs / 1000).toFixed(1)}초</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="terminal-notice">
                여기서 판이 끝납니다.{' '}
                {node?.kind === 'terminal' && node.terminal === 'fold'
                  ? '한 명이 접어서 남은 사람이 팟을 가져갑니다.'
                  : '카드를 보여주고 강한 쪽이 팟을 가져갑니다.'}{' '}
                위 경로에서 다른 지점을 눌러 되돌아갈 수 있어요.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


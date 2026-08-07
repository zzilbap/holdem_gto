'use client';

import { RANKS, SUITS, type Card } from '@holdem/poker-core';
import { POSITIONS_6MAX, POSITION_LABELS_KO, type Position } from '@holdem/solver';

import type { SeatState } from '@/lib/table-view';

/**
 * 연습용 테이블 그림.
 *
 * 글로만 "당신은 컷오프입니다"라고 하면 초보자는 그게 어디인지 감이 안 온다.
 * 자리를 실제 배치로 보여주면 앞에 몇 명이 남았는지가 한눈에 들어온다 —
 * 그게 포지션 개념의 전부이기도 하다.
 *
 * **모든 자리는 상태가 있어야 한다.** 아무 표시도 없는 자리를 남겨두면
 * "얘는 뭘 한 거지?"에서 막힌다. 실제로 그 질문을 받았다.
 */

const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

export interface PokerTableProps {
  hero: Position;
  seats: Record<Position, SeatState>;
  pot: number;
  cards?: [Card, Card];
}

export function PokerTable({ hero, seats, pot, cards }: PokerTableProps) {
  return (
    <div className="table-wrap">
      <div className="table-felt">
        <div className="table-pot">
          <span className="pot-label">팟</span>
          <span className="pot-value">{fmt(pot)}bb</span>
        </div>
      </div>

      <div className="table-seats">
        {POSITIONS_6MAX.map((position) => {
          const seat = seats[position];
          const isHero = position === hero;
          return (
            <div
              key={position}
              className={
                'table-seat' +
                (isHero ? ' is-hero' : '') +
                (seat.status === 'folded' ? ' is-folded' : '') +
                (seat.status === 'pending' ? ' is-pending' : '') +
                (seat.aggressor ? ' is-aggressor' : '')
              }
            >
              <span className="seat-code">{position}</span>
              <span className="seat-name">{POSITION_LABELS_KO[position].full}</span>
              <span className="seat-state-row">
                {isHero && <span className="seat-tag">나</span>}
                {seat.status === 'folded' && <span className="seat-state">폴드</span>}
                {seat.status === 'pending' && <span className="seat-state">아직</span>}
                {seat.invested !== undefined && seat.invested > 0 && (
                  <span className={`seat-state${seat.aggressor ? ' bet' : ' put'}`}>
                    {fmt(seat.invested)}bb
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {cards && (
        <div className="hole-cards">
          {cards.map((card) => (
            <span key={card} className={`card big suit-${SUITS[card & 3]}`}>
              <span className="rank">{RANKS[card >> 2]}</span>
              <span className="suit">{SUIT_SYMBOL[SUITS[card & 3]!]}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

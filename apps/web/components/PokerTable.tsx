'use client';

import { RANKS, SUITS, type Card } from '@holdem/poker-core';
import { POSITIONS_6MAX, POSITION_LABELS_KO, type Position } from '@holdem/solver';

/**
 * 연습용 테이블 그림.
 *
 * 글로만 "당신은 컷오프입니다"라고 하면 초보자는 그게 어디인지 감이 안 온다.
 * 자리를 실제 배치로 보여주면 앞에 몇 명이 남았는지가 한눈에 들어온다 —
 * 그게 포지션 개념의 전부이기도 하다.
 */

const SUIT_SYMBOL: Record<string, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

export interface PokerTableProps {
  hero: Position;
  /** 이미 접은 자리. */
  folded: Position[];
  /** 레이즈한 자리와 금액. */
  aggressor?: { position: Position; amount: number } | null;
  pot: number;
  cards?: [Card, Card];
}

export function PokerTable({ hero, folded, aggressor, pot, cards }: PokerTableProps) {
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
          const isHero = position === hero;
          const isFolded = folded.includes(position);
          const isAggressor = aggressor?.position === position;
          return (
            <div
              key={position}
              className={
                'table-seat' +
                (isHero ? ' is-hero' : '') +
                (isFolded ? ' is-folded' : '') +
                (isAggressor ? ' is-aggressor' : '')
              }
            >
              <span className="seat-code">{position}</span>
              <span className="seat-name">{POSITION_LABELS_KO[position].full}</span>
              {isHero && <span className="seat-tag">나</span>}
              {isFolded && <span className="seat-state">폴드</span>}
              {isAggressor && <span className="seat-state bet">{fmt(aggressor.amount)}bb</span>}
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

'use client';

import { useId, useState } from 'react';

/**
 * 용어에 뜻을 붙이는 장치.
 *
 * 이 프로젝트가 존재하는 이유가 "Wizard는 용어를 알아야 쓸 수 있다"였는데,
 * 정작 우리 화면에도 설명 없는 말이 널려 있었다(오픈 크기, bb, 스택…).
 * 용어를 쓸 거면 뜻이 항상 한 번의 동작 안에 있어야 한다.
 *
 * 마우스를 올리거나(데스크톱) 눌러서(모바일) 펼친다. 툴팁만 쓰면 터치 기기에서
 * 읽을 방법이 없다.
 */

export interface TermProps {
  /** 화면에 보이는 말. */
  children: React.ReactNode;
  /** 펼쳤을 때 나오는 설명. 한두 문장으로 끝낸다. */
  title: string;
  detail: string;
}

export function Term({ children, title, detail }: TermProps) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="term-wrap">
      <button
        type="button"
        className="term"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {children}
      </button>
      {open && (
        <span className="term-pop" id={id} role="tooltip">
          <strong>{title}</strong>
          {detail}
        </span>
      )}
    </span>
  );
}

/** 화면 곳곳에서 같은 설명을 쓰도록 한곳에 모아 둔다. */
export const GLOSSARY = {
  bb: {
    title: 'bb (빅블라인드)',
    detail:
      '판돈을 세는 단위입니다. 블라인드가 500/1000원인 판이면 1bb는 1,000원입니다. 판마다 돈 단위가 달라도 bb로 말하면 전략이 그대로 통합니다.',
  },
  stack: {
    title: '스택',
    detail:
      '내 앞에 쌓인 칩, 즉 이번 판에 걸 수 있는 최대 금액입니다. 스택이 짧을수록 플롭 이후에 할 수 있는 게 적어져서 프리플롭에서 더 과감해집니다.',
  },
  openSize: {
    title: '오픈 크기',
    detail:
      '아무도 안 들어온 상태에서 내가 처음 레이즈할 때 거는 금액입니다. 작게 열면 실패해도 덜 잃으니 더 많은 패로 시도할 수 있고, 크게 열면 상대가 자주 접는 대신 실패할 때 손실이 큽니다.',
  },
  open: {
    title: '오픈',
    detail: '앞사람이 모두 폴드한 상태에서 내가 처음으로 레이즈해 판에 들어가는 것입니다.',
  },
  threeBet: {
    title: '3벳 (재레이즈)',
    detail:
      '누가 오픈했는데 그 위에 다시 올리는 것입니다. 블라인드를 1벳, 오픈을 2벳으로 세기 때문에 3벳이라 부릅니다.',
  },
  fourBet: {
    title: '4벳',
    detail: '3벳을 맞은 사람이 또 한 번 올리는 것입니다. 여기까지 오면 양쪽 다 아주 강한 패입니다.',
  },
  suited: {
    title: '수딧 / 오프수트',
    detail:
      '두 장의 무늬가 같으면 수딧(s), 다르면 오프수트(o)입니다. 무늬가 같으면 플러시를 노릴 수 있어 같은 숫자라도 더 셉니다.',
  },
  equity: {
    title: '에퀴티',
    detail: '지금 올인하면 이 패가 판돈의 몇 %를 가져가는지를 뜻합니다.',
  },
  convergence: {
    title: '수렴 지표',
    detail:
      '계산을 더 돌려도 답이 얼마나 안 바뀌는지를 나타냅니다. 0에 가까울수록 안정된 답이라는 뜻입니다.',
  },
} as const;

export type GlossaryKey = keyof typeof GLOSSARY;

/** 사전에 있는 용어를 키만으로 쓰는 축약형. */
export function T({ k, children }: { k: GlossaryKey; children?: React.ReactNode }) {
  const entry = GLOSSARY[k];
  return (
    <Term title={entry.title} detail={entry.detail}>
      {children ?? entry.title.split(' ')[0]}
    </Term>
  );
}

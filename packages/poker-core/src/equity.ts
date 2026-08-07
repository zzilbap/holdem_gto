import { NUM_CARDS, type Card } from './cards';
import { evaluate } from './hand-eval';
import { NUM_COMBOS, comboCards, type ComboRange } from './range';

/**
 * 에퀴티 = "지금 올인하면 이 핸드가 팟의 몇 %를 가져가는가".
 *
 * 솔버 내부는 에퀴티를 쓰지 않는다 (CFR은 터미널 노드에서 직접 쇼다운을 비교한다).
 * 이 파일은 순전히 화면에 숫자를 띄우기 위한 것이다 —
 * 초보자에게 "왜 이 핸드로 콜하나"를 설명할 때 에퀴티만큼 잘 통하는 지표가 없다.
 */

export interface EquityResult {
  /** 0~1. 무승부는 절반씩 나눈 값이 포함된다. */
  equity: number;
  win: number;
  tie: number;
  lose: number;
}

/** 보드에 남은 장수만큼 런아웃을 전부 열거한다. 플롭(2장 남음)이면 1081가지. */
function remainingDeck(dead: readonly Card[]): Card[] {
  const used = new Uint8Array(NUM_CARDS);
  for (const c of dead) used[c] = 1;
  const out: Card[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!used[c]) out.push(c);
  return out;
}

/**
 * 핸드 대 핸드. 보드가 3장 이상이면 전수 열거, 그보다 적으면 몬테카를로.
 * 프리플롭 전수 열거는 171만 가지라 화면 응답용으로는 과하다.
 */
export function handVsHandEquity(
  hero: readonly [Card, Card],
  villain: readonly [Card, Card],
  board: readonly Card[],
  samples = 20000,
): EquityResult {
  const dead = [...hero, ...villain, ...board];
  const deck = remainingDeck(dead);
  const need = 5 - board.length;

  let win = 0;
  let tie = 0;
  let total = 0;

  const heroCards: Card[] = [hero[0], hero[1], ...board, 0, 0];
  const villainCards: Card[] = [villain[0], villain[1], ...board, 0, 0];
  const base = 2 + board.length;

  const tally = (runout: readonly Card[]) => {
    for (let i = 0; i < runout.length; i++) {
      heroCards[base + i] = runout[i]!;
      villainCards[base + i] = runout[i]!;
    }
    const len = base + runout.length;
    const h = evaluate(heroCards.slice(0, len));
    const v = evaluate(villainCards.slice(0, len));
    if (h > v) win++;
    else if (h === v) tie++;
    total++;
  };

  if (need <= 2) {
    enumerateCombinations(deck, need, tally);
  } else {
    const runout: Card[] = new Array(need);
    for (let s = 0; s < samples; s++) {
      sampleWithoutReplacement(deck, need, runout);
      tally(runout);
    }
  }

  const lose = total - win - tie;
  return {
    equity: total === 0 ? 0 : (win + tie / 2) / total,
    win: total === 0 ? 0 : win / total,
    tie: total === 0 ? 0 : tie / total,
    lose: total === 0 ? 0 : lose / total,
  };
}

/**
 * 핸드 대 레인지. 상대 레인지에서 내 카드와 겹치는 콤보는 자동으로 빠진다 —
 * 이게 블로커 효과다. UI에서 "내가 As를 들고 있어서 상대의 넛플러시가 줄어든다"를
 * 설명할 때 이 함수가 근거가 된다.
 */
export function handVsRangeEquity(
  hero: readonly [Card, Card],
  villainRange: ComboRange,
  board: readonly Card[],
  samples = 3000,
): EquityResult {
  let wSum = 0;
  let eq = 0;
  let win = 0;
  let tie = 0;
  let lose = 0;

  const blocked = new Uint8Array(NUM_CARDS);
  blocked[hero[0]] = 1;
  blocked[hero[1]] = 1;
  for (const c of board) blocked[c] = 1;

  for (let combo = 0; combo < NUM_COMBOS; combo++) {
    const weight = villainRange[combo]!;
    if (weight <= 0) continue;
    const [a, b] = comboCards(combo);
    if (blocked[a] || blocked[b]) continue;

    const r = handVsHandEquity(hero, [a, b], board, samples);
    eq += r.equity * weight;
    win += r.win * weight;
    tie += r.tie * weight;
    lose += r.lose * weight;
    wSum += weight;
  }

  if (wSum === 0) return { equity: 0, win: 0, tie: 0, lose: 0 };
  return { equity: eq / wSum, win: win / wSum, tie: tie / wSum, lose: lose / wSum };
}

/** deck에서 k개를 고르는 모든 조합에 대해 fn 호출. k는 0~2만 쓴다. */
function enumerateCombinations(
  deck: readonly Card[],
  k: number,
  fn: (chosen: readonly Card[]) => void,
): void {
  if (k === 0) {
    fn([]);
    return;
  }
  if (k === 1) {
    const buf: Card[] = [0];
    for (let i = 0; i < deck.length; i++) {
      buf[0] = deck[i]!;
      fn(buf);
    }
    return;
  }
  const buf: Card[] = [0, 0];
  for (let i = 0; i < deck.length; i++) {
    buf[0] = deck[i]!;
    for (let j = i + 1; j < deck.length; j++) {
      buf[1] = deck[j]!;
      fn(buf);
    }
  }
}

function sampleWithoutReplacement(deck: readonly Card[], k: number, out: Card[]): void {
  // 부분 피셔-예이츠. 덱을 건드리지 않으려고 뽑은 것만 되돌린다.
  const n = deck.length;
  const picked: number[] = [];
  for (let i = 0; i < k; i++) {
    let idx: number;
    let dup: boolean;
    do {
      idx = (Math.random() * n) | 0;
      dup = picked.includes(idx);
    } while (dup);
    picked.push(idx);
    out[i] = deck[idx]!;
  }
}

import {
  NUM_CARDS,
  NUM_COMBOS,
  comboCards,
  evaluate,
  type Card,
  type ComboRange,
} from '@holdem/poker-core';

/**
 * 보드가 정해진 상태에서 두 레인지를 다루기 위한 준비물.
 *
 * 플롭 솔버의 성능은 **콤보를 몇 개나 들고 도느냐**로 결정된다.
 * 1326개를 전부 쓰면 터미널 노드마다 176만 번을 계산해야 하고 브라우저에서 못 돈다.
 * 보드와 겹치는 콤보를 빼고 레인지에 실제로 있는 것만 남기면 보통 300~500개로 줄어,
 * 같은 계산이 9만~25만 번이 된다. 20배 차이다.
 */

export interface LiveCombos {
  /** 살아있는 콤보의 원래 인덱스 (0..1325). */
  indices: Int32Array;
  /** indices[k]에 해당하는 두 장의 카드. */
  cardA: Uint8Array;
  cardB: Uint8Array;
  /** 레인지에서의 비중 (0~1). */
  weight: Float32Array;
  count: number;
}

/** 보드와 겹치지 않고 비중이 0보다 큰 콤보만 추린다. */
export function collectLiveCombos(range: ComboRange, board: readonly Card[]): LiveCombos {
  const onBoard = new Uint8Array(NUM_CARDS);
  for (const card of board) onBoard[card] = 1;

  const indices: number[] = [];
  const cardA: number[] = [];
  const cardB: number[] = [];
  const weight: number[] = [];

  for (let combo = 0; combo < NUM_COMBOS; combo++) {
    const w = range[combo]!;
    if (w <= 0) continue;
    const [a, b] = comboCards(combo);
    if (onBoard[a] || onBoard[b]) continue;
    indices.push(combo);
    cardA.push(a);
    cardB.push(b);
    weight.push(w);
  }

  return {
    indices: Int32Array.from(indices),
    cardA: Uint8Array.from(cardA),
    cardB: Uint8Array.from(cardB),
    weight: Float32Array.from(weight),
    count: indices.length,
  };
}

/**
 * 두 콤보가 카드를 공유하는지.
 *
 * 공유하면 그 조합은 애초에 존재할 수 없다. 쇼다운에서 이걸 빼먹으면
 * "둘 다 같은 As를 들고 있는" 경우를 세게 되고, 블로커가 강한 핸드일수록 오차가 커진다.
 */
export function combosCollide(
  live: LiveCombos,
  i: number,
  other: LiveCombos,
  j: number,
): boolean {
  const ai = live.cardA[i]!;
  const bi = live.cardB[i]!;
  const aj = other.cardA[j]!;
  const bj = other.cardB[j]!;
  return ai === aj || ai === bj || bi === aj || bi === bj;
}

/**
 * 플롭 이후의 에퀴티 행렬.
 *
 * `equity[i * villainCount + j]` = 내 콤보 i가 상대 콤보 j를 상대로
 * 턴·리버를 끝까지 봤을 때의 승률(무승부 절반 포함).
 *
 * 남은 두 장을 전부 열거한다(1081가지). 몬테카를로를 쓰지 않는 이유는
 * 이 표가 CFR 전체의 정답 기준이 되기 때문이다 — 여기에 잡음이 섞이면
 * 그 위에서 아무리 잘 수렴시켜도 답이 흔들린다.
 */
export function buildFlopEquityMatrix(
  hero: LiveCombos,
  villain: LiveCombos,
  board: readonly Card[],
  onProgress?: (done: number, total: number) => void,
): Float32Array {
  const onBoard = new Uint8Array(NUM_CARDS);
  for (const card of board) onBoard[card] = 1;

  const deck: number[] = [];
  for (let c = 0; c < NUM_CARDS; c++) if (!onBoard[c]) deck.push(c);

  const win = new Float32Array(hero.count * villain.count);
  const total = new Float32Array(hero.count * villain.count);

  // 런아웃마다 모든 콤보의 강도를 한 번씩만 평가하고, 그 값을 쌍 비교에 재사용한다.
  const heroStrength = new Int32Array(hero.count);
  const villainStrength = new Int32Array(villain.count);
  const cards = [0, 0, board[0]!, board[1]!, board[2]!, 0, 0];

  let done = 0;
  const runouts = (deck.length * (deck.length - 1)) / 2;

  for (let x = 0; x < deck.length; x++) {
    const turn = deck[x]!;
    cards[5] = turn;
    for (let y = x + 1; y < deck.length; y++) {
      const river = deck[y]!;
      cards[6] = river;

      for (let i = 0; i < hero.count; i++) {
        const a = hero.cardA[i]!;
        const b = hero.cardB[i]!;
        if (a === turn || a === river || b === turn || b === river) {
          heroStrength[i] = -1;
          continue;
        }
        cards[0] = a;
        cards[1] = b;
        heroStrength[i] = evaluate(cards);
      }
      for (let j = 0; j < villain.count; j++) {
        const a = villain.cardA[j]!;
        const b = villain.cardB[j]!;
        if (a === turn || a === river || b === turn || b === river) {
          villainStrength[j] = -1;
          continue;
        }
        cards[0] = a;
        cards[1] = b;
        villainStrength[j] = evaluate(cards);
      }

      for (let i = 0; i < hero.count; i++) {
        const si = heroStrength[i]!;
        if (si < 0) continue;
        const ai = hero.cardA[i]!;
        const bi = hero.cardB[i]!;
        const row = i * villain.count;

        for (let j = 0; j < villain.count; j++) {
          const sj = villainStrength[j]!;
          if (sj < 0) continue;
          const aj = villain.cardA[j]!;
          if (ai === aj || bi === aj) continue;
          const bj = villain.cardB[j]!;
          if (ai === bj || bi === bj) continue;

          total[row + j]++;
          if (si > sj) win[row + j]++;
          else if (si === sj) win[row + j] += 0.5;
        }
      }

      done++;
      if (onProgress && done % 100 === 0) onProgress(done, runouts);
    }
  }

  const equity = new Float32Array(hero.count * villain.count);
  for (let k = 0; k < equity.length; k++) {
    equity[k] = total[k] > 0 ? win[k] / total[k] : 0.5;
  }
  return equity;
}

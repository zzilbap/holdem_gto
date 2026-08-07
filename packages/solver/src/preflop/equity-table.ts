import {
  NUM_CARDS,
  NUM_COMBOS,
  NUM_HANDS,
  comboCards,
  comboIndex,
  comboToHandIndex,
  evaluate,
} from '@holdem/poker-core';

/**
 * 프리플롭 CFR이 돌려면 두 개의 169×169 표가 필요하다.
 *
 *  1. 에퀴티 표    — "AKs가 QQ 상대로 올인하면 몇 %인가"
 *  2. 충돌 계수 표 — "내가 AA를 들고 있을 때 상대가 AA일 가능성은 몇 콤보인가"
 *
 * 2번이 없으면 블로커를 무시하게 되고, AA끼리 부딪히는 빈도를 6배 과대평가한다.
 * 프리플롭 차트에서 이 오차는 4벳/5벳 레인지에 눈에 띄게 나타난다.
 */

export const EQUITY_TABLE_SIZE = NUM_HANDS * NUM_HANDS;

// ---------------------------------------------------------------------------
// 충돌 계수 — 결정적이라 그냥 계산한다
// ---------------------------------------------------------------------------

let collisionCache: Float32Array | null = null;

/**
 * `collision[i * 169 + j]` = 내가 핸드 i를 하나 들고 있을 때
 * 상대가 가질 수 있는 핸드 j의 평균 콤보 수.
 *
 * 겹치지 않는 핸드끼리는 그냥 j의 콤보 수(페어 6, 수딧 4, 오프수트 12)가 나오고,
 * 카드를 공유하는 조합에서만 값이 깎인다.
 */
export function collisionMatrix(): Float32Array {
  if (collisionCache) return collisionCache;

  const out = new Float32Array(EQUITY_TABLE_SIZE);
  const counts = new Float64Array(EQUITY_TABLE_SIZE);
  const handCombos = new Int32Array(NUM_HANDS);

  const cardA = new Uint8Array(NUM_COMBOS);
  const cardB = new Uint8Array(NUM_COMBOS);
  const hand = new Uint8Array(NUM_COMBOS);
  for (let c = 0; c < NUM_COMBOS; c++) {
    const [a, b] = comboCards(c);
    cardA[c] = a;
    cardB[c] = b;
    hand[c] = comboToHandIndex(c);
    handCombos[hand[c]]++;
  }

  for (let i = 0; i < NUM_COMBOS; i++) {
    const ai = cardA[i];
    const bi = cardB[i];
    const hi = hand[i] * NUM_HANDS;
    for (let j = 0; j < NUM_COMBOS; j++) {
      const aj = cardA[j];
      const bj = cardB[j];
      if (ai === aj || ai === bj || bi === aj || bi === bj) continue;
      counts[hi + hand[j]]++;
    }
  }

  for (let i = 0; i < NUM_HANDS; i++) {
    for (let j = 0; j < NUM_HANDS; j++) {
      // counts는 "i의 모든 콤보에 대해 합산한 값"이므로 i의 콤보 수로 나눈다.
      out[i * NUM_HANDS + j] = counts[i * NUM_HANDS + j] / handCombos[i];
    }
  }

  collisionCache = out;
  return out;
}

// ---------------------------------------------------------------------------
// 에퀴티 표 — 몬테카를로로 만든다
// ---------------------------------------------------------------------------

export interface EquityTableOptions {
  /** 뽑을 보드 수. 보드 하나가 58만 개 매치업 표본을 만들어내므로 이것만으로 충분하다. */
  boardSamples: number;
  seed: number;
  onProgress?: (done: number, total: number) => void;
}

/**
 * `equity[i * 169 + j]` = 핸드 i가 핸드 j 상대로 5장을 다 깔았을 때의 승률(무승부 절반 포함).
 *
 * 매치업마다 따로 시뮬레이션하지 않는다. 보드 한 장을 뽑으면 그 보드 위에서
 * 1081개 콤보의 강도가 한 번에 정해지고, 거기서 나오는 58만 개 콤보 쌍이
 * 모든 매치업의 표본이 된다. 매치업별 몬테카를로보다 수십 배 효율적이다.
 */
export function buildPreflopEquityTable(options: EquityTableOptions): Float32Array {
  const { boardSamples, seed } = options;
  const rng = mulberry32(seed);

  const win = new Float64Array(EQUITY_TABLE_SIZE);
  const total = new Float64Array(EQUITY_TABLE_SIZE);

  const maxCombos = 1081; // C(47,2)
  const cardA = new Uint8Array(maxCombos);
  const cardB = new Uint8Array(maxCombos);
  const handIdx = new Uint8Array(maxCombos);
  const strength = new Int32Array(maxCombos);

  const board = new Uint8Array(5);
  const onBoard = new Uint8Array(NUM_CARDS);
  const seven = [0, 0, 0, 0, 0, 0, 0];

  for (let sample = 0; sample < boardSamples; sample++) {
    onBoard.fill(0);
    for (let i = 0; i < 5; i++) {
      let c: number;
      do {
        c = (rng() * NUM_CARDS) | 0;
      } while (onBoard[c]);
      onBoard[c] = 1;
      board[i] = c;
    }
    for (let i = 0; i < 5; i++) seven[2 + i] = board[i];

    let n = 0;
    for (let a = 0; a < NUM_CARDS; a++) {
      if (onBoard[a]) continue;
      seven[0] = a;
      for (let b = a + 1; b < NUM_CARDS; b++) {
        if (onBoard[b]) continue;
        seven[1] = b;
        cardA[n] = a;
        cardB[n] = b;
        handIdx[n] = comboToHandIndex(comboIndex(a, b));
        strength[n] = evaluate(seven);
        n++;
      }
    }

    for (let i = 0; i < n; i++) {
      const ai = cardA[i];
      const bi = cardB[i];
      const hi = handIdx[i] * NUM_HANDS;
      const si = strength[i];
      for (let j = i + 1; j < n; j++) {
        const aj = cardA[j];
        const bj = cardB[j];
        if (ai === aj || ai === bj || bi === aj || bi === bj) continue;

        const hj = handIdx[j];
        const forward = hi + hj;
        const backward = hj * NUM_HANDS + handIdx[i];
        const sj = strength[j];

        if (si > sj) win[forward] += 1;
        else if (si < sj) win[backward] += 1;
        else {
          win[forward] += 0.5;
          win[backward] += 0.5;
        }
        total[forward] += 1;
        total[backward] += 1;
      }
    }

    options.onProgress?.(sample + 1, boardSamples);
  }

  const equity = new Float32Array(EQUITY_TABLE_SIZE);
  for (let k = 0; k < EQUITY_TABLE_SIZE; k++) {
    equity[k] = total[k] > 0 ? win[k] / total[k] : 0.5;
  }
  return equity;
}

// ---------------------------------------------------------------------------
// 직렬화 — 표는 빌드 타임에 한 번 만들고 파일로 들고 다닌다
// ---------------------------------------------------------------------------

/**
 * Float32 28,561개를 그대로 JSON에 넣으면 800KB가 넘는다.
 * 에퀴티는 0~1이라 Uint16으로 양자화하면 오차 0.0008%에 57KB로 줄고,
 * 이 정도 오차는 몬테카를로 표본오차보다 두 자릿수 작아서 무해하다.
 */
export function packEquityTable(table: Float32Array): string {
  const quantized = new Uint16Array(EQUITY_TABLE_SIZE);
  for (let i = 0; i < EQUITY_TABLE_SIZE; i++) {
    quantized[i] = Math.round(Math.min(1, Math.max(0, table[i])) * 65535);
  }
  return bytesToBase64(new Uint8Array(quantized.buffer));
}

export function unpackEquityTable(packed: string): Float32Array {
  const bytes = base64ToBytes(packed);
  const quantized = new Uint16Array(bytes.buffer, bytes.byteOffset, EQUITY_TABLE_SIZE);
  const table = new Float32Array(EQUITY_TABLE_SIZE);
  for (let i = 0; i < EQUITY_TABLE_SIZE; i++) table[i] = quantized[i] / 65535;
  return table;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(binary, 'binary').toString('base64');
}

function base64ToBytes(text: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(text);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, 'base64'));
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

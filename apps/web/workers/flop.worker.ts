/// <reference lib="webworker" />

import type { Card, ComboRange } from '@holdem/poker-core';
import {
  DEFAULT_FLOP_CONFIG,
  buildFlopEquityMatrix,
  buildFlopTree,
  collectLiveCombos,
  solveFlop,
} from '@holdem/solver';

/**
 * 플롭 솔브 워커.
 *
 * 프리플롭과 달리 플롭은 미리 계산해 둘 수 없다. 보드가 1,755가지(전략적으로 다른 것만
 * 세도)이고 거기에 스팟 조합까지 곱해지기 때문이다. 그래서 볼 때마다 그 자리에서 푼다.
 *
 * 시간은 에퀴티 행렬 만드는 데 대부분 들어간다 — 런아웃 1,081가지를 전수로 도는데,
 * 여기에 몬테카를로를 쓰면 CFR이 잡음 위에서 수렴하게 되므로 정확도를 포기할 수 없다.
 */

export interface FlopWorkerRequest {
  id: number;
  type: 'solve';
  board: Card[];
  oopRange: Float32Array;
  ipRange: Float32Array;
  pot: number;
  effectiveStack: number;
  iterations: number;
}

export interface FlopWorkerCancel {
  id: number;
  type: 'cancel';
}

export type FlopWorkerInbound = FlopWorkerRequest | FlopWorkerCancel;

export type FlopWorkerOutbound =
  | { id: number; type: 'phase'; phase: 'equity' | 'solve'; ratio: number }
  | {
      id: number;
      type: 'done';
      /** 전략 배열과 트리를 되짚을 수 있는 최소 정보. */
      strategy: Float32Array;
      oopEv: Float32Array;
      ipEv: Float32Array;
      /** 살아있는 콤보의 원래 인덱스 — 화면이 169칸으로 되돌릴 때 쓴다. */
      oopCombos: Int32Array;
      ipCombos: Int32Array;
      meanEv: [number, number];
      elapsedMs: number;
    }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'cancelled' };

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();

scope.onmessage = (event: MessageEvent<FlopWorkerInbound>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }

  const { id } = message;
  const startedAt = Date.now();

  try {
    const oop = collectLiveCombos(message.oopRange as ComboRange, message.board);
    const ip = collectLiveCombos(message.ipRange as ComboRange, message.board);

    if (oop.count === 0 || ip.count === 0) {
      post({ id, type: 'error', message: '이 보드에서 남는 핸드가 없습니다.' });
      return;
    }

    const equity = buildFlopEquityMatrix(oop, ip, message.board, (done, total) => {
      if (done % 200 !== 0) return;
      post({ id, type: 'phase', phase: 'equity', ratio: done / total });
    });

    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ id, type: 'cancelled' });
      return;
    }

    const tree = buildFlopTree(
      { ...DEFAULT_FLOP_CONFIG, pot: message.pot, effectiveStack: message.effectiveStack },
      [oop.count, ip.count],
    );

    const result = solveFlop(tree, {
      iterations: message.iterations,
      hero: oop,
      villain: ip,
      equity,
      shouldStop: () => cancelled.has(id),
      onProgress: (iteration, total) => {
        if (iteration % 25 !== 0) return;
        post({ id, type: 'phase', phase: 'solve', ratio: iteration / total });
      },
    });

    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ id, type: 'cancelled' });
      return;
    }

    post(
      {
        id,
        type: 'done',
        strategy: result.strategy,
        oopEv: result.ev[0],
        ipEv: result.ev[1],
        oopCombos: oop.indices,
        ipCombos: ip.indices,
        meanEv: result.meanEv,
        elapsedMs: Date.now() - startedAt,
      },
      [
        result.strategy.buffer as ArrayBuffer,
        result.ev[0].buffer as ArrayBuffer,
        result.ev[1].buffer as ArrayBuffer,
        oop.indices.buffer as ArrayBuffer,
        ip.indices.buffer as ArrayBuffer,
      ],
    );
  } catch (error) {
    post({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    cancelled.delete(id);
  }
};

function post(message: FlopWorkerOutbound, transfers?: Transferable[]): void {
  if (transfers && transfers.length > 0) scope.postMessage(message, transfers);
  else scope.postMessage(message);
}

/// <reference lib="webworker" />

import {
  MEASURED_REALIZATION,
  MeasuredRealization,
  solvePreflop,
  type PreflopConfig,
} from '@holdem/solver';

/**
 * 프리플롭 전체 솔브를 돌리는 워커.
 *
 * 스팟 15개를 여러 라운드 왕복하면 수십 초가 걸린다. 메인 스레드에서 돌리면
 * 그동안 클릭도 스크롤도 안 먹는다. 그래서 통째로 여기로 보낸다.
 *
 * 나중에 서버 솔브로 옮기더라도 이 파일만 안 쓰게 되고, 화면 코드는 그대로다.
 * SolverTransport 인터페이스가 그 경계다.
 */

export interface WorkerRequest {
  id: number;
  type: 'solve';
  config: PreflopConfig;
  equityTable: Float32Array;
  rounds: number;
  iterationsPerSpot: number;
}

export interface WorkerCancel {
  id: number;
  type: 'cancel';
}

export type WorkerInbound = WorkerRequest | WorkerCancel;

export type WorkerOutbound =
  | { id: number; type: 'progress'; done: number; total: number; label: string }
  | {
      id: number;
      type: 'done';
      openFrequency: Record<string, Float32Array>;
      openEdge: Record<string, Float32Array>;
      spots: Record<string, { strategy: Float32Array; responderFold: Float32Array }>;
      lastRoundDrift: number;
      elapsedMs: number;
    }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'cancelled' };

const scope = self as unknown as DedicatedWorkerGlobalScope;

/** 취소된 요청 번호. 진행 중인 솔브는 매 스팟마다 이걸 확인하고 빠져나온다. */
const cancelled = new Set<number>();

scope.onmessage = (event: MessageEvent<WorkerInbound>) => {
  const message = event.data;

  if (message.type === 'cancel') {
    cancelled.add(message.id);
    return;
  }

  const { id } = message;
  const startedAt = Date.now();

  try {
    // 진행률을 너무 자주 보내면 메인 스레드가 렌더링에 치인다. 스팟이 바뀔 때만 알린다.
    let lastLabel = '';

    const solution = solvePreflop({
      config: message.config,
      equityTable: message.equityTable,
      realization: new MeasuredRealization(MEASURED_REALIZATION),
      rounds: message.rounds,
      iterationsPerSpot: message.iterationsPerSpot,
      shouldStop: () => cancelled.has(id),
      onProgress: (done, total, label) => {
        if (label === lastLabel) return;
        lastLabel = label;
        post({ id, type: 'progress', done, total, label });
      },
    });

    if (cancelled.has(id)) {
      cancelled.delete(id);
      post({ id, type: 'cancelled' });
      return;
    }

    const spots: Record<string, { strategy: Float32Array; responderFold: Float32Array }> = {};
    const transfers: Transferable[] = [];
    // TypedArray.buffer는 SharedArrayBuffer일 수도 있다는 타입이라 좁혀 준다.
    // 여기서 만든 배열은 전부 일반 ArrayBuffer다.
    const claim = (array: Float32Array) => transfers.push(array.buffer as ArrayBuffer);

    for (const [key, spot] of solution.spots) {
      spots[key] = {
        strategy: spot.result.strategy,
        responderFold: spot.responderFoldProbability,
      };
      claim(spot.result.strategy);
      claim(spot.responderFoldProbability);
    }

    const openFrequency: Record<string, Float32Array> = {};
    const openEdge: Record<string, Float32Array> = {};
    for (const [position, values] of Object.entries(solution.openFrequency)) {
      openFrequency[position] = values;
      claim(values);
    }
    for (const [position, values] of Object.entries(solution.openEdge)) {
      openEdge[position] = values;
      claim(values);
    }

    // 버퍼를 복사하지 않고 소유권만 넘긴다. 결과가 수 MB라 복사 비용이 무시 못 할 수준이다.
    post(
      {
        id,
        type: 'done',
        openFrequency,
        openEdge,
        spots,
        lastRoundDrift: solution.lastRoundDrift,
        elapsedMs: Date.now() - startedAt,
      },
      transfers,
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

function post(message: WorkerOutbound, transfers?: Transferable[]): void {
  if (transfers && transfers.length > 0) {
    scope.postMessage(message, transfers);
  } else {
    scope.postMessage(message);
  }
}

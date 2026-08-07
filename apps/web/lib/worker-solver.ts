import type { PreflopConfig } from '@holdem/solver';
import type { WorkerInbound, WorkerOutbound } from '@/workers/preflop.worker';

/**
 * 워커를 감싸는 브라우저 측 클라이언트.
 *
 * 화면은 이 클래스만 알고 워커의 존재를 모른다. 나중에 서버 솔브로 바꿀 때
 * 여기 구현만 fetch로 갈아끼우면 되고, 호출하는 쪽은 손대지 않는다.
 */

export interface PreflopSolveProgress {
  done: number;
  total: number;
  ratio: number;
  label: string;
}

export interface PreflopSolveOutcome {
  openFrequency: Record<string, Float32Array>;
  openEdge: Record<string, Float32Array>;
  spots: Record<string, { strategy: Float32Array; responderFold: Float32Array }>;
  lastRoundDrift: number;
  elapsedMs: number;
}

export class WorkerPreflopSolver {
  private worker: Worker | null = null;
  private nextId = 1;
  private activeId: number | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('../workers/preflop.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.worker;
  }

  solve(
    config: PreflopConfig,
    equityTable: Float32Array,
    options: { rounds: number; iterationsPerSpot: number },
    onProgress?: (progress: PreflopSolveProgress) => void,
  ): Promise<PreflopSolveOutcome> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    this.activeId = id;

    return new Promise<PreflopSolveOutcome>((resolve, reject) => {
      const handle = (event: MessageEvent<WorkerOutbound>) => {
        const message = event.data;
        // 취소된 이전 요청의 응답이 늦게 도착할 수 있다. 번호로 걸러낸다.
        if (message.id !== id) return;

        switch (message.type) {
          case 'progress':
            onProgress?.({
              done: message.done,
              total: message.total,
              ratio: message.total > 0 ? message.done / message.total : 0,
              label: message.label,
            });
            break;

          case 'done':
            cleanup();
            resolve({
              openFrequency: message.openFrequency,
              openEdge: message.openEdge,
              spots: message.spots,
              lastRoundDrift: message.lastRoundDrift,
              elapsedMs: message.elapsedMs,
            });
            break;

          case 'cancelled':
            cleanup();
            reject(new SolveCancelled());
            break;

          case 'error':
            cleanup();
            reject(new Error(message.message));
            break;
        }
      };

      const cleanup = () => {
        worker.removeEventListener('message', handle);
        if (this.activeId === id) this.activeId = null;
      };

      worker.addEventListener('message', handle);

      // 에퀴티 표는 소유권을 넘기지 않는다. 메인 스레드도 계속 써야 하고,
      // 114KB라 복사 비용이 무시할 만하다.
      const request: WorkerInbound = {
        id,
        type: 'solve',
        config,
        equityTable,
        rounds: options.rounds,
        iterationsPerSpot: options.iterationsPerSpot,
      };
      worker.postMessage(request);
    });
  }

  cancel(): void {
    if (this.activeId === null || !this.worker) return;
    const message: WorkerInbound = { id: this.activeId, type: 'cancel' };
    this.worker.postMessage(message);
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.activeId = null;
  }
}

/** 사용자가 설정을 다시 바꿔서 이전 계산을 버린 경우. 오류로 취급하지 않는다. */
export class SolveCancelled extends Error {
  constructor() {
    super('계산이 취소되었습니다');
    this.name = 'SolveCancelled';
  }
}

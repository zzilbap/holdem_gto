import {
  buildSpotTree,
  solvePreflop,
  solveSpot,
  spotKey,
  type RealizationModel,
  type SolveResult,
} from '@holdem/solver';
import type {
  PreflopSolveRequest,
  PreflopSolveResponse,
  SolveProgress,
  SolverTransport,
  SpotSolveRequest,
} from './transport';

/**
 * 같은 스레드에서 바로 푸는 구현.
 *
 * 테스트와 Node 스크립트(프리솔브 데이터 생성)에서 쓴다. 브라우저 UI에서 쓰면
 * 계산하는 동안 화면이 멈추므로 거기서는 Worker 구현을 쓴다.
 */
export class LocalSolverTransport implements SolverTransport {
  readonly name = 'local';
  private cancelled = false;

  constructor(
    private readonly deps: {
      equityTable: Float32Array;
      realization: RealizationModel;
    },
  ) {}

  async solve(
    request: SpotSolveRequest,
    onProgress?: (progress: SolveProgress) => void,
  ): Promise<SolveResult> {
    this.cancelled = false;
    const tree = buildSpotTree(request.spot, request.config);

    return solveSpot(tree, {
      iterations: request.iterations,
      ranges: request.ranges,
      equityTable: this.deps.equityTable,
      realization: this.deps.realization,
      onProgress: onProgress
        ? (iteration, total) => onProgress({ iteration, total, ratio: iteration / total })
        : undefined,
      shouldStop: () => this.cancelled,
    });
  }

  async solvePreflop(
    request: PreflopSolveRequest,
    onProgress?: (progress: SolveProgress) => void,
  ): Promise<PreflopSolveResponse> {
    this.cancelled = false;
    const startedAt = Date.now();

    const solution = solvePreflop({
      config: request.config,
      equityTable: request.equityTable,
      realization: this.deps.realization,
      rounds: request.rounds,
      iterationsPerSpot: request.iterationsPerSpot,
      onProgress: onProgress
        ? (done, total, label) => onProgress({ iteration: done, total, ratio: done / total, label })
        : undefined,
      shouldStop: () => this.cancelled,
    });

    const spots: PreflopSolveResponse['spots'] = {};
    for (const [key, spot] of solution.spots) {
      spots[key] = {
        strategy: spot.result.strategy,
        responderFold: spot.responderFoldProbability,
      };
    }

    return {
      openFrequency: { ...solution.openFrequency },
      openEdge: { ...solution.openEdge },
      spots,
      lastRoundDrift: solution.lastRoundDrift,
      elapsedMs: Date.now() - startedAt,
    };
  }

  cancel(): void {
    this.cancelled = true;
  }

  dispose(): void {
    this.cancelled = true;
  }
}

/** 트리 키 규칙을 바깥에서도 쓸 수 있게 다시 내보낸다. */
export { spotKey };

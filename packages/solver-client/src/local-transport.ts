import {
  buildSpotTree,
  solveSpot,
  type RealizationModel,
  type SolveResult,
} from '@holdem/solver';
import type { SolveProgress, SolverTransport, SpotSolveRequest } from './transport';

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

  cancel(): void {
    this.cancelled = true;
  }

  dispose(): void {
    this.cancelled = true;
  }
}

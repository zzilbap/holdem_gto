import type { PreflopConfig, SolveResult, SpotDefinition } from '@holdem/solver';

/**
 * 솔브를 **어디서 돌릴지**를 격리하는 인터페이스.
 *
 * 지금은 브라우저 Worker에서 돌지만, 나중에 서버 CFR로 옮길 때 바뀌는 건
 * 이 인터페이스의 구현체 하나뿐이다. UI는 어디서 계산되는지 모른 채 그대로 남는다.
 *
 *   지금  : WorkerSolverTransport  (브라우저, 정적 배포)
 *   나중  : RemoteSolverTransport  (POST /api/solve)
 *   테스트: LocalSolverTransport   (같은 스레드, 동기)
 */

export interface SpotSolveRequest {
  kind: 'preflop-spot';
  spot: SpotDefinition;
  config: PreflopConfig;
  /** 두 플레이어의 시작 레인지 (169칸). */
  ranges: [Float32Array, Float32Array];
  iterations: number;
}

export interface SolveProgress {
  iteration: number;
  total: number;
  /** 0~1 */
  ratio: number;
}

export interface SolverTransport {
  readonly name: string;
  solve(
    request: SpotSolveRequest,
    onProgress?: (progress: SolveProgress) => void,
  ): Promise<SolveResult>;
  /** 진행 중인 솔브를 버린다. 사용자가 설정을 바꿔 다시 계산할 때 쓴다. */
  cancel(): void;
  dispose(): void;
}

/** 요청이 같으면 다시 풀지 않기 위한 키. 캐시와 기록 탭이 같이 쓴다. */
export function requestKey(request: SpotSolveRequest): string {
  const { spot, config, iterations } = request;
  return JSON.stringify({
    first: spot.first,
    second: spot.second,
    dead: spot.deadMoney,
    invested: spot.invested,
    raises: spot.raiseCount,
    stack: config.stack,
    open: config.openSize,
    threeBetIP: config.threeBetMultiplierIP,
    threeBetOOP: config.threeBetMultiplierOOP,
    fourBet: config.fourBetMultiplier,
    iterations,
  });
}

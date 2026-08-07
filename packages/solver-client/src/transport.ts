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

/**
 * 프리플롭 전체를 다시 푸는 요청.
 *
 * 스택이나 베팅 사이즈를 바꾸면 프리솔브 데이터를 쓸 수 없다. 스팟 15개를
 * 처음부터 다시 풀어야 하고, 그동안 화면이 멈추면 안 되니 Worker로 보낸다.
 *
 * 에퀴티 표는 설정과 무관하므로(카드만의 성질이다) 다시 만들지 않고 넘겨 받는다.
 * 이게 30초 넘게 걸리는 부분이라 재사용 여부가 체감 속도를 좌우한다.
 */
export interface PreflopSolveRequest {
  kind: 'preflop-full';
  config: PreflopConfig;
  equityTable: Float32Array;
  rounds: number;
  iterationsPerSpot: number;
}

/** 트리는 설정에서 결정적으로 만들어지므로 결과에 담지 않는다. 전략 배열만 오간다. */
export interface PreflopSolveResponse {
  openFrequency: Record<string, Float32Array>;
  openEdge: Record<string, Float32Array>;
  spots: Record<string, { strategy: Float32Array; responderFold: Float32Array }>;
  lastRoundDrift: number;
  elapsedMs: number;
}

export interface SolveProgress {
  iteration: number;
  total: number;
  /** 0~1 */
  ratio: number;
  /** "BTN vs BB" 같은 현재 작업 이름. 진행바 옆에 그대로 띄운다. */
  label?: string;
}

export interface SolverTransport {
  readonly name: string;
  solve(
    request: SpotSolveRequest,
    onProgress?: (progress: SolveProgress) => void,
  ): Promise<SolveResult>;
  solvePreflop(
    request: PreflopSolveRequest,
    onProgress?: (progress: SolveProgress) => void,
  ): Promise<PreflopSolveResponse>;
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

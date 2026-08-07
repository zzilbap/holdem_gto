'use client';

import type { PreflopConfig } from '@holdem/solver';
import { useCallback, useEffect, useRef, useState } from 'react';

import { applySolveOutcome, loadPreflopData, type PreflopData } from './preflop-data';
import { SolveCancelled, WorkerPreflopSolver, type PreflopSolveProgress } from './worker-solver';

/**
 * 화면이 쓰는 상태를 한곳에 모은다.
 *
 *  - 처음엔 프리솔브 파일을 그대로 쓴다 (즉시 표시)
 *  - 사용자가 설정을 바꾸면 워커가 그 설정으로 다시 푼다
 *  - 되돌리기를 누르면 프리솔브 결과로 복귀
 *
 * 워커가 서버 API로 바뀌어도 이 훅의 바깥 모양은 그대로다.
 */

/**
 * 브라우저에서 돌릴 때는 빌드 타임보다 가볍게 잡는다.
 * 빌드 스크립트는 6라운드 × 600회를 쓰지만 그건 5분이 걸려도 되는 자리다.
 * 여기서는 20초 안쪽을 목표로 하고, 대신 프리솔브만큼 정밀하지 않다고 화면에 알린다.
 */
const BROWSER_ROUNDS = 4;
const BROWSER_ITERATIONS = 300;

export interface PreflopState {
  data: PreflopData | null;
  error: string | null;
  /** 사용자가 만지고 있는 설정. 아직 적용 전일 수 있다. */
  draft: PreflopConfig | null;
  /** 지금 화면에 반영된 설정. */
  applied: PreflopConfig | null;
  busy: boolean;
  progress: PreflopSolveProgress | null;
  /** 프리솔브 기본값이 아니라 직접 계산한 결과를 보고 있는가. */
  isCustom: boolean;
  lastElapsedMs: number | null;
  setDraft: (config: PreflopConfig) => void;
  apply: () => void;
  cancel: () => void;
  reset: () => void;
}

export function usePreflop(): PreflopState {
  const [baseline, setBaseline] = useState<PreflopData | null>(null);
  const [data, setData] = useState<PreflopData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PreflopConfig | null>(null);
  const [applied, setApplied] = useState<PreflopConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PreflopSolveProgress | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [lastElapsedMs, setLastElapsedMs] = useState<number | null>(null);

  const solverRef = useRef<WorkerPreflopSolver | null>(null);

  useEffect(() => {
    let alive = true;
    loadPreflopData()
      .then((loaded) => {
        if (!alive) return;
        setBaseline(loaded);
        setData(loaded);
        setDraft(loaded.config);
        setApplied(loaded.config);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);

  // 페이지를 떠날 때 워커를 정리한다. 안 그러면 계산이 계속 돈다.
  useEffect(() => {
    return () => {
      solverRef.current?.dispose();
      solverRef.current = null;
    };
  }, []);

  const apply = useCallback(() => {
    if (!draft || !baseline || busy) return;

    if (!solverRef.current) solverRef.current = new WorkerPreflopSolver();
    const solver = solverRef.current;

    setBusy(true);
    setProgress(null);
    setError(null);

    solver
      .solve(
        draft,
        baseline.equityTable,
        { rounds: BROWSER_ROUNDS, iterationsPerSpot: BROWSER_ITERATIONS },
        setProgress,
      )
      .then((outcome) => {
        setData(applySolveOutcome(baseline, draft, outcome));
        setApplied(draft);
        setIsCustom(true);
        setLastElapsedMs(outcome.elapsedMs);
      })
      .catch((e: unknown) => {
        // 취소는 사용자가 의도한 것이므로 오류로 띄우지 않는다.
        if (e instanceof SolveCancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setBusy(false);
        setProgress(null);
      });
  }, [draft, baseline, busy]);

  const cancel = useCallback(() => {
    solverRef.current?.cancel();
  }, []);

  const reset = useCallback(() => {
    if (!baseline) return;
    solverRef.current?.cancel();
    setData(baseline);
    setDraft(baseline.config);
    setApplied(baseline.config);
    setIsCustom(false);
    setLastElapsedMs(null);
  }, [baseline]);

  return {
    data,
    error,
    draft,
    applied,
    busy,
    progress,
    isCustom,
    lastElapsedMs,
    setDraft,
    apply,
    cancel,
    reset,
  };
}

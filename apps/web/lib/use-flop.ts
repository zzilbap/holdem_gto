'use client';

import { comboIndex, parseCards, type Card } from '@holdem/poker-core';
import {
  DEFAULT_6MAX_100BB,
  DEFAULT_FLOP_CONFIG,
  applyAction,
  buildFlopTree,
  initialSequence,
  undoLast,
  type FlopActionNode,
  type FlopTree,
  type SequenceState,
} from '@holdem/solver';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FlopSetup } from './flop-setup';
import { resolveSequence, type SequenceResolution } from './sequence-resolve';
import type { PreflopData } from './preflop-data';
import type { FlopWorkerInbound, FlopWorkerOutbound } from '@/workers/flop.worker';

/**
 * 플롭 화면의 상태를 한곳에 모은다.
 *
 * 플롭은 프리솔브가 불가능해서(보드 × 스팟 조합이 폭발한다) 볼 때마다 푼다.
 * 그래서 진행 상황을 두 단계로 나눠 보여준다 — 에퀴티 계산과 CFR은 체감 시간이
 * 다르고, 하나의 막대로 합치면 중간에 멈춘 것처럼 보인다.
 */

const ITERATIONS = 400;

export interface FlopSolution {
  tree: FlopTree;
  strategy: Float32Array;
  ev: [Float32Array, Float32Array];
  /** 살아있는 콤보의 원래 인덱스(0..1325). 화면에서 내 패를 찾을 때 쓴다. */
  combos: [Int32Array, Int32Array];
  /** 원래 콤보 인덱스 → 배열 위치. 없으면 그 보드에서 불가능한 패다. */
  lookup: [Map<number, number>, Map<number, number>];
  meanEv: [number, number];
  elapsedMs: number;
  board: Card[];
  setup: FlopSetup & { actionText: string };
}

export interface FlopProgress {
  phase: 'equity' | 'solve';
  ratio: number;
}

export interface FlopState {
  /** 사용자가 직접 쌓아 만든 프리플롭 액션. */
  sequence: SequenceState;
  /** 그 시퀀스가 어떤 상황인지 — 진행 중인지, 풀 수 있는지, 다시 풀어야 하는지. */
  resolution: SequenceResolution | null;
  setup: (FlopSetup & { actionText: string }) | null;
  board: Card[];
  boardText: string;
  solution: FlopSolution | null;
  busy: boolean;
  progress: FlopProgress | null;
  error: string | null;
  /** 지금 보고 있는 플롭 액션 경로. 각 원소는 그 노드에서 고른 액션 번호다. */
  line: number[];
  act: (kind: 'fold' | 'check' | 'call' | 'raise', to?: number) => void;
  undo: () => void;
  resetSequence: () => void;
  setBoardText: (text: string) => void;
  randomBoard: () => void;
  solve: () => void;
  cancel: () => void;
  pushAction: (actionIndex: number) => void;
  popTo: (depth: number) => void;
}

export function useFlop(data: PreflopData | null): FlopState {
  const [boardText, setBoardText] = useState('Kh8d3c');
  const [solution, setSolution] = useState<FlopSolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<FlopProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [line, setLine] = useState<number[]>([]);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const [sequence, setSequence] = useState<SequenceState>(() =>
    initialSequence(data?.config ?? DEFAULT_6MAX_100BB),
  );

  // 설정이 바뀌면(스택·사이즈 재계산) 쌓아둔 액션도 그 설정 기준으로 다시 시작한다.
  useEffect(() => {
    if (data) setSequence(initialSequence(data.config));
  }, [data]);

  const resolution = useMemo(
    () => (data ? resolveSequence(data, sequence) : null),
    [data, sequence],
  );

  const setup = resolution?.kind === 'ready' ? resolution.setup : null;

  const act = useCallback(
    (kind: 'fold' | 'check' | 'call' | 'raise', to?: number) => {
      setSequence((current) => (current.toAct === null ? current : applyAction(current, kind, to)));
    },
    [],
  );

  const undo = useCallback(() => setSequence(undoLast), []);
  const resetSequence = useCallback(() => {
    if (data) setSequence(initialSequence(data.config));
  }, [data]);

  const board = useMemo(() => {
    try {
      const cards = parseCards(boardText);
      return cards.length === 3 ? cards : [];
    } catch {
      return [];
    }
  }, [boardText]);

  // 보드나 상황이 바뀌면 이전 결과는 더 이상 그 상황의 답이 아니다.
  useEffect(() => {
    setSolution(null);
    setLine([]);
  }, [boardText, sequence]);

  const solve = useCallback(() => {
    if (!setup || board.length !== 3 || busy) return;

    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../workers/flop.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    const worker = workerRef.current;
    const id = ++requestIdRef.current;

    setBusy(true);
    setError(null);
    setProgress({ phase: 'equity', ratio: 0 });

    const handle = (event: MessageEvent<FlopWorkerOutbound>) => {
      const message = event.data;
      if (message.id !== id) return;

      if (message.type === 'phase') {
        setProgress({ phase: message.phase, ratio: message.ratio });
        return;
      }

      worker.removeEventListener('message', handle);
      setBusy(false);
      setProgress(null);

      if (message.type === 'error') {
        setError(message.message);
        return;
      }
      if (message.type === 'cancelled') return;

      const tree = buildFlopTree(
        {
          ...DEFAULT_FLOP_CONFIG,
          pot: setup.pot,
          effectiveStack: setup.effectiveStack,
        },
        [message.oopCombos.length, message.ipCombos.length],
      );

      setSolution({
        tree,
        strategy: message.strategy,
        ev: [message.oopEv, message.ipEv],
        combos: [message.oopCombos, message.ipCombos],
        lookup: [indexMap(message.oopCombos), indexMap(message.ipCombos)],
        meanEv: message.meanEv,
        elapsedMs: message.elapsedMs,
        board,
        setup,
      });
      setLine([]);
    };

    worker.addEventListener('message', handle);
    const request: FlopWorkerInbound = {
      id,
      type: 'solve',
      board,
      oopRange: setup.oopRange,
      ipRange: setup.ipRange,
      pot: setup.pot,
      effectiveStack: setup.effectiveStack,
      iterations: ITERATIONS,
    };
    worker.postMessage(request);
  }, [setup, board, busy]);

  const cancel = useCallback(() => {
    if (!workerRef.current) return;
    const message: FlopWorkerInbound = { id: requestIdRef.current, type: 'cancel' };
    workerRef.current.postMessage(message);
  }, []);

  const randomBoard = useCallback(() => {
    const used = new Set<number>();
    while (used.size < 3) used.add(Math.floor(Math.random() * 52));
    const ranks = '23456789TJQKA';
    const suits = 'cdhs';
    setBoardText(
      [...used].map((c) => ranks[c >> 2]! + suits[c & 3]!).join(''),
    );
  }, []);

  const pushAction = useCallback((actionIndex: number) => {
    setLine((current) => [...current, actionIndex]);
  }, []);

  const popTo = useCallback((depth: number) => {
    setLine((current) => current.slice(0, depth));
  }, []);

  return {
    sequence,
    resolution,
    setup,
    board,
    boardText,
    solution,
    busy,
    progress,
    error,
    line,
    act,
    undo,
    resetSequence,
    setBoardText,
    randomBoard,
    solve,
    cancel,
    pushAction,
    popTo,
  };
}

function indexMap(indices: Int32Array): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < indices.length; i++) map.set(indices[i]!, i);
  return map;
}

/** 액션 경로를 따라 내려간 현재 노드. 중간에 터미널을 만나면 거기서 멈춘다. */
export function walkLine(tree: FlopTree, line: readonly number[]) {
  let index = tree.root;
  const path: Array<{ node: FlopActionNode; chosen: number }> = [];

  for (const actionIndex of line) {
    const node = tree.nodes[index]!;
    if (node.kind !== 'action') break;
    if (actionIndex >= node.actions.length) break;
    path.push({ node, chosen: actionIndex });
    index = node.children[actionIndex]!;
  }

  return { node: tree.nodes[index]!, path };
}

/** 두 카드로 이 보드에서의 콤보 배열 위치를 찾는다. */
export function findComboSlot(
  solution: FlopSolution,
  player: 0 | 1,
  cards: readonly [Card, Card],
): number | null {
  const slot = solution.lookup[player].get(comboIndex(cards[0], cards[1]));
  return slot ?? null;
}

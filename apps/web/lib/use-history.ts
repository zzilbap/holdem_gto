'use client';

import type { PreflopConfig, Position } from '@holdem/solver';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LocalHistoryRepository, type HistoryEntry, type HistoryRepository } from './history';
import type { Advice, Scenario } from './scenario';

/**
 * 조회 기록 훅.
 *
 * 패를 클릭할 때마다 바로 저장하면 훑어보기만 해도 기록이 수십 개 쌓인다.
 * 잠깐 머문 화면은 빼고, 실제로 들여다본 것만 남긴다.
 */

/** 이 시간 이상 같은 화면에 머물러야 기록한다. */
const DWELL_MS = 2500;

export interface HistoryState {
  entries: HistoryEntry[];
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  clear: () => void;
}

export function useHistory(
  current: {
    hero: Position;
    scenario: Scenario | undefined;
    handIndex: number;
    config: PreflopConfig | null;
    advice: Advice | null;
  },
  enabled: boolean,
): HistoryState {
  const repository = useMemo<HistoryRepository>(() => new LocalHistoryRepository(), []);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    repository.list().then(setEntries);
  }, [repository]);

  const { hero, scenario, handIndex, config, advice } = current;

  useEffect(() => {
    if (!enabled || !scenario || !config || !advice) return;

    // 도달하지 않는 상황은 기록할 가치가 없다. 답이 없는 화면이기 때문이다.
    if (advice.unreachable) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      repository
        .record({
          hero,
          scenario,
          handIndex,
          config,
          summary: advice.headline,
          tone: advice.primary.kind,
        })
        .then(setEntries);
    }, DWELL_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, repository, hero, scenario, handIndex, config, advice]);

  const remove = useCallback(
    (id: string) => {
      repository.remove(id).then(setEntries);
    },
    [repository],
  );

  const togglePin = useCallback(
    (id: string) => {
      repository.togglePin(id).then(setEntries);
    },
    [repository],
  );

  const clear = useCallback(() => {
    repository.clear().then(setEntries);
  }, [repository]);

  return { entries, remove, togglePin, clear };
}

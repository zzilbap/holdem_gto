import type { PreflopConfig, Position } from '@holdem/solver';
import type { Scenario } from './scenario';

/**
 * 조회 기록.
 *
 * 저장 위치를 인터페이스 뒤에 둔다. 지금은 이 기기의 localStorage지만,
 * 계정이 생기면 같은 인터페이스로 서버에 쌓인다. 기록이 기기에 묶이지 않으려면
 * 이 격리가 처음부터 있어야 한다 — 나중에 붙이려면 화면 코드를 다 뒤져야 한다.
 */

export interface HistoryEntry {
  id: string;
  /** 마지막으로 이 상황을 본 시각. 같은 조회를 반복하면 갱신된다. */
  viewedAt: number;
  hero: Position;
  scenario: Scenario;
  handIndex: number;
  /** 이 기록을 남길 때의 설정. 스택이 다르면 다른 기록이다. */
  config: PreflopConfig;
  /** 목록에서 바로 읽을 수 있게 결론을 같이 저장한다. */
  summary: string;
  /** 결론의 액션 종류. 목록에서 색으로 구분한다. */
  tone: string;
  /** 고정하면 정리 대상에서 제외되고 목록 위로 올라온다. */
  pinned: boolean;
}

export interface HistoryRepository {
  list(): Promise<HistoryEntry[]>;
  /** 같은 상황을 다시 보면 새로 쌓지 않고 시각만 갱신한다. */
  record(entry: Omit<HistoryEntry, 'id' | 'viewedAt' | 'pinned'>): Promise<HistoryEntry[]>;
  remove(id: string): Promise<HistoryEntry[]>;
  togglePin(id: string): Promise<HistoryEntry[]>;
  clear(): Promise<HistoryEntry[]>;
}

const STORAGE_KEY = 'holdem-gto:history:v1';

/** 고정하지 않은 기록의 보관 한도. 넘으면 오래된 것부터 지운다. */
const MAX_UNPINNED = 100;

export class LocalHistoryRepository implements HistoryRepository {
  async list(): Promise<HistoryEntry[]> {
    return sortEntries(read());
  }

  async record(
    input: Omit<HistoryEntry, 'id' | 'viewedAt' | 'pinned'>,
  ): Promise<HistoryEntry[]> {
    const entries = read();
    const key = identityOf(input);
    const existing = entries.find((entry) => identityOf(entry) === key);

    if (existing) {
      existing.viewedAt = Date.now();
      existing.summary = input.summary;
      existing.tone = input.tone;
    } else {
      entries.push({
        ...input,
        id: makeId(),
        viewedAt: Date.now(),
        pinned: false,
      });
    }

    return write(prune(entries));
  }

  async remove(id: string): Promise<HistoryEntry[]> {
    return write(read().filter((entry) => entry.id !== id));
  }

  async togglePin(id: string): Promise<HistoryEntry[]> {
    const entries = read();
    const target = entries.find((entry) => entry.id === id);
    if (target) target.pinned = !target.pinned;
    return write(entries);
  }

  async clear(): Promise<HistoryEntry[]> {
    // 고정한 기록은 남긴다. 전부 날리는 건 사용자가 따로 지워야 한다.
    return write(read().filter((entry) => entry.pinned));
  }
}

/**
 * 같은 기록인지 판단하는 키.
 *
 * 자리·상황·패가 같아도 **설정이 다르면 다른 기록**이다.
 * 100bb에서의 답과 40bb에서의 답은 다른 정보이기 때문이다.
 */
function identityOf(entry: Omit<HistoryEntry, 'id' | 'viewedAt' | 'pinned'>): string {
  const villain = 'villain' in entry.scenario ? entry.scenario.villain : '-';
  return [
    entry.hero,
    entry.scenario.kind,
    villain,
    entry.handIndex,
    entry.config.stack,
    entry.config.openSize.UTG,
    entry.config.openSize.SB,
  ].join('|');
}

/** 고정된 것 먼저, 그다음 최근 순. */
function sortEntries(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.viewedAt - a.viewedAt;
  });
}

function prune(entries: HistoryEntry[]): HistoryEntry[] {
  const pinned = entries.filter((entry) => entry.pinned);
  const rest = entries
    .filter((entry) => !entry.pinned)
    .sort((a, b) => b.viewedAt - a.viewedAt)
    .slice(0, MAX_UNPINNED);
  return [...pinned, ...rest];
}

function read(): HistoryEntry[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    // 저장 형식이 바뀌었거나 손상된 경우. 기록 때문에 앱이 죽으면 안 된다.
    return [];
  }
}

function write(entries: HistoryEntry[]): HistoryEntry[] {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // 용량 초과 등. 저장에 실패해도 화면은 계속 돌아가야 한다.
    }
  }
  return sortEntries(entries);
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** "3분 전", "어제" 같은 표기. 목록에서 절대 시각보다 읽기 쉽다. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '방금';
  if (diff < hour) return `${Math.floor(diff / minute)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 2 * day) return '어제';
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`;
  return new Date(timestamp).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

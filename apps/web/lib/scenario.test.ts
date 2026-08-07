import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handStringToIndex } from '@holdem/poker-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { parsePreflopData, type PreflopData, type PreflopDataFile } from './preflop-data';
import { describeScenario, getAdvice, listScenariosFor, scenarioTitle } from './scenario';

/**
 * 화면에 실제로 뜰 값을 검증한다.
 *
 * 컴포넌트를 렌더링해서 픽셀을 보는 대신, 컴포넌트가 받게 될 데이터를 직접 확인한다.
 * "BTN에서 AA를 들었을 때 화면에 뭐라고 뜨는가"가 곧 이 테스트다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../public/data/preflop-6max-100bb.json');

let data: PreflopData;

beforeAll(() => {
  const file = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as PreflopDataFile;
  data = parsePreflopData(file);
});

describe('프리솔브 데이터', () => {
  it('15개 스팟이 트리와 크기가 맞게 실려 있다', () => {
    // parsePreflopData가 크기 불일치를 던지므로 여기까지 왔다면 이미 통과다.
    expect(data.spots.size).toBe(15);
  });

  it('수렴 지표가 충분히 작다', () => {
    expect(data.meta.drift).toBeLessThan(0.01);
  });
});

describe('상황 목록', () => {
  it('BB는 오픈할 상황이 없다', () => {
    const kinds = listScenariosFor('BB').map((s) => s.kind);
    expect(kinds).not.toContain('open');
  });

  it('UTG는 앞사람이 없어 vs-open 상황이 없다', () => {
    const kinds = listScenariosFor('UTG').map((s) => s.kind);
    expect(kinds).not.toContain('vs-open');
    expect(kinds).toContain('open');
    expect(kinds).toContain('vs-3bet');
  });

  it('BTN에는 오픈·대응·3벳 대응이 모두 있다', () => {
    const scenarios = listScenariosFor('BTN');
    expect(scenarios.some((s) => s.kind === 'open')).toBe(true);
    expect(scenarios.some((s) => s.kind === 'vs-open')).toBe(true);
    expect(scenarios.some((s) => s.kind === 'vs-3bet')).toBe(true);
  });
});

describe('상황 설명 문장', () => {
  it('약어 대신 한국어로 상황을 풀어쓴다', () => {
    const text = describeScenario({ kind: 'open', hero: 'BTN' }, data.config);
    expect(text).toContain('버튼');
    expect(text).toContain('모두 폴드');
    expect(text).toContain('bb');
    // 포지션 이름 뒤 조사도 받침에 맞아야 한다.
    expect(text).not.toContain('버튼가');
    console.log(`\n[오픈 상황]\n  ${text}`);
  });

  it('상대의 레이즈 금액과 내가 더 낼 돈을 알려준다', () => {
    const text = describeScenario({ kind: 'vs-open', hero: 'BB', villain: 'BTN' }, data.config);
    expect(text).toContain('빅블라인드');
    expect(text).toContain('버튼');
    expect(text).toMatch(/더 내면/);
    expect(text).not.toContain(')가 ');
    console.log(`[오픈 대응 상황]\n  ${text}`);
  });
});

describe('결론이 상식과 맞는가', () => {
  const adviceFor = (scenario: Parameters<typeof getAdvice>[1], hand: string) => {
    const result = getAdvice(data, scenario, handStringToIndex(hand));
    if (!result) throw new Error(`조언 없음: ${hand}`);
    return result;
  };

  it('BTN에서 AA는 무조건 레이즈', () => {
    const advice = adviceFor({ kind: 'open', hero: 'BTN' }, 'AA');
    expect(advice.primary.kind).toBe('raise');
    expect(advice.primary.frequency).toBeGreaterThan(0.95);
    expect(advice.headline).toBe('레이즈하세요');
    console.log(`\n[BTN · AA] ${advice.headline} — ${advice.subline}`);
  });

  it('UTG에서 72o는 폴드', () => {
    const advice = adviceFor({ kind: 'open', hero: 'UTG' }, '72o');
    expect(advice.primary.kind).toBe('fold');
    expect(advice.headline).toBe('폴드하세요');
    console.log(`[UTG · 72o] ${advice.headline} — ${advice.subline}`);
  });

  it('BB가 BTN 오픈에 AA를 들면 3벳한다', () => {
    const advice = adviceFor({ kind: 'vs-open', hero: 'BB', villain: 'BTN' }, 'AA');
    expect(['raise', 'allin']).toContain(advice.primary.kind);
    console.log(`[BB vs BTN · AA] ${advice.headline} — ${advice.subline}`);
  });

  it('BB가 UTG 오픈에 72o를 들면 폴드한다', () => {
    const advice = adviceFor({ kind: 'vs-open', hero: 'BB', villain: 'UTG' }, '72o');
    expect(advice.primary.kind).toBe('fold');
    console.log(`[BB vs UTG · 72o] ${advice.headline} — ${advice.subline}`);
  });

  it('UTG가 오픈하지 않는 패는 3벳 대응 상황 자체가 없다고 알려준다', () => {
    // UTG는 76s를 오픈하지 않는다. 그런데도 솔버 출력을 그대로 띄우면
    // 학습되지 않은 노드의 균등분포(33/33/33)가 조언처럼 보인다.
    const advice = adviceFor({ kind: 'vs-3bet', hero: 'UTG', villain: 'BB' }, '76s');
    expect(advice.unreachable).toBe(true);
    expect(advice.headline).toBe('이 상황은 나오지 않습니다');
    expect(advice.subline).toContain('오픈하지 않는');
    console.log(`[UTG vs 3벳 · 76s] ${advice.headline} — ${advice.subline}`);
  });

  it('UTG가 실제로 오픈하는 패는 3벳 대응이 정상으로 나온다', () => {
    const advice = adviceFor({ kind: 'vs-3bet', hero: 'UTG', villain: 'BB' }, 'AA');
    expect(advice.unreachable).toBe(false);
    expect(advice.primary.kind).not.toBe('fold');
    console.log(`[UTG vs 3벳 · AA] ${advice.headline} — ${advice.subline}`);

    const weak = adviceFor({ kind: 'vs-3bet', hero: 'UTG', villain: 'BB' }, 'AJo');
    console.log(`[UTG vs 3벳 · AJo] ${weak.headline} — ${weak.subline}`);
  });

  it('도달하지 않는 패가 균등분포로 새어 나오지 않는다', () => {
    // 33/33/33처럼 정확히 균등한 분포는 학습되지 않은 노드의 신호다.
    // 그런 게 unreachable 표시 없이 나오면 안 된다.
    let leaked = 0;
    for (const hero of ['UTG', 'HJ', 'CO', 'BTN'] as const) {
      for (const scenario of listScenariosFor(hero)) {
        if (scenario.kind !== 'vs-3bet' && scenario.kind !== 'vs-4bet') continue;
        for (let h = 0; h < 169; h++) {
          const advice = getAdvice(data, scenario, h);
          if (!advice || advice.unreachable) continue;
          const uniform = 1 / advice.options.length;
          const isUniform = advice.options.every((o) => Math.abs(o.frequency - uniform) < 0.01);
          if (isUniform) leaked++;
        }
      }
    }
    console.log(`균등분포가 조언으로 새어 나온 칸 ${leaked}개`);
    expect(leaked).toBe(0);
  });

  it('4벳을 맞아도 AA는 접지 않는다', () => {
    const advice = adviceFor({ kind: 'vs-4bet', hero: 'BB', villain: 'BTN' }, 'AA');
    expect(advice.primary.kind).not.toBe('fold');
    console.log(`[BB vs 4벳 · AA] ${advice.headline} — ${advice.subline}`);
  });

  it('모든 상황·모든 패에서 빈도 합이 1이다', () => {
    for (const hero of ['UTG', 'BTN', 'BB'] as const) {
      for (const scenario of listScenariosFor(hero)) {
        for (let h = 0; h < 169; h += 17) {
          const advice = getAdvice(data, scenario, h);
          if (!advice) continue;
          const sum = advice.options.reduce((acc, o) => acc + o.frequency, 0);
          expect(sum, `${scenarioTitle(scenario)} / 핸드 ${h}`).toBeCloseTo(1, 1);
        }
      }
    }
  });

  it('섞어 치는 패는 그렇다고 말해준다', () => {
    /**
     * RFI는 거의 순수 전략으로 나온다 — 오픈이 이득이면 열고 아니면 접는다.
     * 섞는 패는 CFR이 직접 푸는 대응 상황(오픈에 맞서는 자리)에서 주로 나온다.
     * 그래서 한 상황만 보지 않고 여러 자리를 훑는다.
     */
    let found = 0;
    let example = '';
    for (const hero of ['UTG', 'CO', 'BTN', 'SB', 'BB'] as const) {
      for (const scenario of listScenariosFor(hero)) {
        for (let h = 0; h < 169; h++) {
          const advice = getAdvice(data, scenario, h);
          if (!advice?.isMixed) continue;
          expect(advice.subline).toContain('섞어');
          expect(advice.headline).toContain('주로');
          if (!example) example = `${advice.headline} — ${advice.subline}`;
          found++;
        }
      }
    }
    console.log(`[혼합 예시] ${example}`);
    console.log(`섞어 치는 패가 나오는 칸 ${found}개`);
    expect(found).toBeGreaterThan(0);
  });
});

describe('상황 문장이 자리마다 맞는가', () => {
  it('UTG에는 "앞사람이 폴드했다"고 쓰지 않는다', () => {
    // UTG는 첫 번째 자리다. 앞에 아무도 없다.
    const text = describeScenario({ kind: 'open', hero: 'UTG' }, data.config);
    expect(text).not.toContain('앞자리');
    expect(text).not.toContain('앞사람');
    expect(text).toContain('가장 먼저 행동');
    console.log(`\n  [UTG 오픈]\n    ${text}`);
  });

  it('뒷자리는 앞사람이 몇 명 접었는지 알려준다', () => {
    const text = describeScenario({ kind: 'open', hero: 'BTN' }, data.config);
    expect(text).toContain('앞자리 3명');
    expect(text).toContain('뒤에는 아직 2명');
    console.log(`  [BTN 오픈]\n    ${text}`);
  });

  it('BB 오픈 상황은 존재하지 않는다', () => {
    const kinds = listScenariosFor('BB').map((s) => s.kind);
    expect(kinds).not.toContain('open');
  });

  it('오픈에 대응할 때 내 뒤에 남은 사람을 알려준다', () => {
    // BTN이 UTG 오픈에 대응 — SB·BB는 아직 행동 전이다.
    const text = describeScenario({ kind: 'vs-open', hero: 'BTN', villain: 'UTG' }, data.config);
    expect(text).toContain('뒤에는 아직 2명');
    console.log(`  [BTN vs UTG 오픈]\n    ${text}`);
  });

  it('마지막 자리(BB)에는 "뒤에 남았다"고 쓰지 않는다', () => {
    const text = describeScenario({ kind: 'vs-open', hero: 'BB', villain: 'BTN' }, data.config);
    expect(text).not.toContain('뒤에는');
    console.log(`  [BB vs BTN 오픈]\n    ${text}\n`);
  });

  it('3벳 이후에는 둘만 남았다고 알려준다', () => {
    const text = describeScenario({ kind: 'vs-3bet', hero: 'UTG', villain: 'BB' }, data.config);
    expect(text).toContain('나머지는 모두 접었');
  });
});

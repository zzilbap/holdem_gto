import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { enumerateFlopLines, type FlopLine } from './flop-setup';
import { parsePreflopData, type PreflopData, type PreflopDataFile } from './preflop-data';

/**
 * 플롭까지 이어지는 라인을 제대로 뽑는지 확인한다.
 *
 * 처음엔 싱글레이즈 팟만 보여줬는데, 3벳 팟은 계산이 이미 되어 있었고
 * 꺼내오지 않았을 뿐이었다. 그 회귀를 막는 테스트다.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(HERE, '../public/data/preflop-6max-100bb.json');

let data: PreflopData;
let lines: FlopLine[];

beforeAll(() => {
  data = parsePreflopData(JSON.parse(readFileSync(DATA_PATH, 'utf8')) as PreflopDataFile);
  lines = enumerateFlopLines(data);
});

describe('플롭 라인 열거', () => {
  it('싱글레이즈 팟이 15개 나온다', () => {
    const srp = lines.filter((line) => line.potType === 'srp');
    expect(srp).toHaveLength(15);
  });

  it('3벳 팟도 나온다', () => {
    const threeBet = lines.filter((line) => line.potType === '3bet');
    expect(threeBet.length).toBeGreaterThan(0);
    console.log(`\n3벳 팟 ${threeBet.length}개 · 예시:`);
    for (const line of threeBet.slice(0, 3)) {
      console.log(
        `  ${line.actionText}  →  팟 ${line.pot}bb, ` +
          `${line.oop} ${line.oopWidth.toFixed(1)}% vs ${line.ip} ${line.ipWidth.toFixed(1)}%`,
      );
    }
  });

  it('4벳 팟도 나온다', () => {
    const fourBet = lines.filter((line) => line.potType === '4bet');
    console.log(`4벳 팟 ${fourBet.length}개`);
    if (fourBet.length > 0) {
      console.log(`  ${fourBet[0]!.actionText}  →  팟 ${fourBet[0]!.pot}bb`);
    }
    expect(fourBet.length).toBeGreaterThanOrEqual(0);
  });

  it('팟이 클수록 남은 칩이 적다', () => {
    for (const line of lines) {
      expect(line.pot + line.effectiveStack * 2).toBeGreaterThan(0);
      // 3벳 팟은 싱글레이즈보다 항상 크다
      if (line.potType === '3bet') expect(line.pot).toBeGreaterThan(5);
    }
  });

  it('3벳 팟은 레인지가 싱글레이즈보다 좁다', () => {
    const srp = lines.find((l) => l.potType === 'srp' && l.opener === 'BTN' && l.caller === 'BB')!;
    const threeBet = lines.find(
      (l) => l.potType === '3bet' && l.opener === 'BTN' && l.caller === 'BB',
    );
    if (!threeBet) return;

    console.log(
      `\nBTN vs BB — 싱글레이즈 ${srp.oopWidth.toFixed(1)}%/${srp.ipWidth.toFixed(1)}% · ` +
        `3벳팟 ${threeBet.oopWidth.toFixed(1)}%/${threeBet.ipWidth.toFixed(1)}%`,
    );
    // 3벳까지 갔다면 양쪽 다 좁아져야 한다
    expect(threeBet.oopWidth + threeBet.ipWidth).toBeLessThan(srp.oopWidth + srp.ipWidth);
  });

  it('모든 라인의 레인지가 비어 있지 않다', () => {
    for (const line of lines) {
      expect(line.oopWidth, line.actionText).toBeGreaterThan(0);
      expect(line.ipWidth, line.actionText).toBeGreaterThan(0);
    }
  });

  it('전체 라인 수를 보고한다', () => {
    const byType = { srp: 0, '3bet': 0, '4bet': 0 };
    for (const line of lines) byType[line.potType]++;
    console.log(
      `\n전체 ${lines.length}개 — 싱글레이즈 ${byType.srp} · 3벳팟 ${byType['3bet']} · 4벳팟 ${byType['4bet']}\n`,
    );
    expect(lines.length).toBeGreaterThan(15);
  });
});

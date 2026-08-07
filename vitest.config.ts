import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // 워크스페이스 패키지는 빌드 산출물이 아니라 소스를 그대로 가리킨다.
    // 빌드 단계 없이 바로 돌릴 수 있고, 스택 트레이스도 원본 줄 번호로 나온다.
    alias: {
      '@holdem/poker-core': pkg('poker-core'),
      '@holdem/solver': pkg('solver'),
      '@holdem/solver-client': pkg('solver-client'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts'],
    testTimeout: 300000,
  },
});

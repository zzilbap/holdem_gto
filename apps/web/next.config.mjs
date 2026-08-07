/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 정적 사이트로 뽑는다. `next build`가 out/ 에 순수 HTML·JS를 남기고
   * 서버 없이 어디든 올릴 수 있다.
   *
   * 나중에 로그인·저장·서버 솔브가 필요해지면 **이 한 줄만 지우면** 된다.
   * SSR과 app/api/* 가 그대로 열린다. 그래서 파일 배치는 처음부터
   * App Router 규칙을 지켜 둔다.
   */
  output: 'export',

  // 워크스페이스 패키지는 소스 TS를 그대로 가져다 쓴다. 별도 빌드 단계가 없다.
  transpilePackages: ['@holdem/poker-core', '@holdem/solver', '@holdem/solver-client'],

  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;

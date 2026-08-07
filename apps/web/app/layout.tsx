import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '홀덤 GTO — 초보자용 솔버',
  description:
    '텍사스 홀덤 GTO 전략을 초보자도 바로 이해할 수 있게 보여주는 솔버. 상황을 문장으로 설명하고 결론부터 알려줍니다.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}

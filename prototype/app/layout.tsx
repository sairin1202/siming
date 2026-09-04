import type { Metadata } from 'next';
import { Noto_Sans_SC, Playfair_Display } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_SC({
  variable: '--font-sans-cn',
  subsets: ['latin'],
});

const display = Playfair_Display({
  variable: '--font-display',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://angel-devil-decision.hazy-fly-5505.chatgpt.site'),
  title: 'Angel & Devil — 让两个声音替你辩论',
  description: '召唤代表 Yes 的天使和代表 No 的恶魔，听完双方，再亲自作出决定。',
  openGraph: {
    type: 'website',
    url: '/',
    title: 'Angel & Devil — 让两个声音替你辩论',
    description: '召唤代表 Yes 的天使和代表 No 的恶魔，听完双方，再亲自作出决定。',
    images: [{
      url: '/og.png',
      width: 1731,
      height: 909,
      alt: 'Angel & Devil 决策舞台',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Angel & Devil — 让两个声音替你辩论',
    description: '召唤代表 Yes 的天使和代表 No 的恶魔，听完双方，再亲自作出决定。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${sans.variable} ${display.variable}`}>{children}</body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Ma_Shan_Zheng, Noto_Serif_SC } from 'next/font/google';
import './globals.css';

const serif = Noto_Serif_SC({
  variable: '--font-sans-cn',
  subsets: ['latin'],
});

// Brush calligraphy for headings, stems and branches.
const brush = Ma_Shan_Zheng({
  weight: '400',
  variable: '--font-brush',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '司命 · 问时 — 拿不定主意时，看看时机',
  description: '说出纠结的事，司命结合你的八字与当下的流年流月，告诉你宜行、待时还是宜止。决定在你。',
  openGraph: {
    type: 'website',
    title: '司命 · 问时',
    description: '拿不定主意时，看看时机。',
    images: [{ url: '/og.jpg', width: 1536, height: 806, alt: '月夜湖面上的星盘' }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.jpg'] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className={`${serif.variable} ${brush.variable}`}>
        {/* Shared SVG filters: ragged brush edges and wet ink bleed. */}
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <filter id="ink-rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="7" />
            <feDisplacementMap in="SourceGraphic" scale="2.6" />
          </filter>
          <filter id="ink-bleed" x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="grain" />
            <feDisplacementMap in="SourceGraphic" in2="grain" scale="3.2" result="rough" />
            <feGaussianBlur in="rough" stdDeviation="0.35" />
          </filter>
          {/* Brush ink, in the 1024-unit space of a written character: ragged
              edges where the hairs splay, a few dry-brush gaps (feibai), and a
              faint wet halo where the ink soaks into the paper. */}
          <filter id="brush-ink" x="-12%" y="-12%" width="124%" height="124%">
            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" seed="4" result="wobble" />
            <feDisplacementMap in="SourceGraphic" in2="wobble" scale="16" result="rough" />
            <feTurbulence type="fractalNoise" baseFrequency="0.01 0.09" numOctaves="2" seed="9" result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -6 0 0 0 4.4" result="hairs" />
            <feComposite in="rough" in2="hairs" operator="in" result="inked" />
            <feGaussianBlur in="rough" stdDeviation="9" result="soak" />
            <feComponentTransfer in="soak" result="halo">
              <feFuncA type="linear" slope="0.32" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode in="halo" />
              <feMergeNode in="inked" />
            </feMerge>
          </filter>
          <filter id="brush-stroke" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.02 0.18" numOctaves="4" seed="11" />
            <feDisplacementMap in="SourceGraphic" scale="6" />
          </filter>
        </svg>
        {children}
      </body>
    </html>
  );
}

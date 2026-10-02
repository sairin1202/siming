import { useEffect, useRef, useState, type CSSProperties } from 'react';

import { WaterRipples } from './ripples';

const GLYPHS = '甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥'.split('');
const RUNES = Array.from({ length: 10 }, (_, index) => ({
  char: GLYPHS[(index * 7) % GLYPHS.length],
  left: (index * 41 + 5) % 92,
  delay: -((index * 3.7) % 30),
  duration: 26 + ((index * 7) % 14),
  size: 18 + ((index * 5) % 16),
}));

// Ink drops that slowly bloom and fade on the paper.
const BLOOMS = Array.from({ length: 6 }, (_, index) => ({
  left: (index * 29 + 12) % 90,
  top: 10 + ((index * 23) % 75),
  size: 80 + ((index * 37) % 140),
  delay: -((index * 4.3) % 24),
  duration: 18 + ((index * 5) % 10),
}));

const MOBILE_QUERY = '(max-width: 820px)';

/**
 * Painted ink-wash backdrop (happyhorse loop over a gpt-image-2 still). Each
 * layer hides itself if its file is missing, revealing the CSS scene below.
 */
function PaintedBackdrop() {
  const [imageOk, setImageOk] = useState(true);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const mobile = matchMedia(MOBILE_QUERY).matches;
    // oxlint-disable-next-line react/react-compiler
    setVideoSrc(mobile ? '/videos/ink-mountains-mobile.mp4' : '/videos/ink-mountains.mp4');
  }, []);

  if (!imageOk && !videoSrc) return null;
  return (
    <div className="scene-painted">
      {imageOk && (
        <picture>
          <source media={MOBILE_QUERY} srcSet="/backgrounds/ink-mountains-mobile.jpg" />
          <img ref={imageRef} src="/backgrounds/ink-mountains.jpg" alt="" onError={() => setImageOk(false)} />
        </picture>
      )}
      {videoSrc && (
        <video
          ref={videoRef}
          key={videoSrc}
          className={videoReady ? 'is-ready' : undefined}
          src={videoSrc}
          autoPlay
          muted
          loop
          playsInline
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoSrc(null)}
        />
      )}
      {/* Redraws the painting through the water, so ripples bend what's behind them. */}
      <WaterRipples
        getSource={() => (videoReady && videoRef.current ? videoRef.current : imageRef.current)}
      />
    </div>
  );
}

/** Ink-wash backdrop: CSS-drawn paper and mountains, painted art on top when available. */
export function InkScene() {
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene-paper" />
      <div className="scene-moon" />
      <svg className="scene-mountains" viewBox="0 0 1600 600" preserveAspectRatio="xMinYMax slice">
        <defs>
          <linearGradient id="ink-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1b1a17" stopOpacity="0.85" />
            <stop offset="0.6" stopColor="#1b1a17" stopOpacity="0.35" />
            <stop offset="1" stopColor="#1b1a17" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="ink-fade-pale" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4a4740" stopOpacity="0.45" />
            <stop offset="1" stopColor="#4a4740" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="ridge"
          fill="url(#ink-fade-pale)"
          d="M0 420 C90 300 160 250 230 330 C280 380 330 220 420 170 C500 130 540 300 620 340 C700 380 760 300 840 360 L840 600 L0 600 Z"
        />
        <path
          className="ridge"
          fill="url(#ink-fade)"
          d="M0 470 C60 380 110 300 170 360 C210 400 250 260 320 230 C380 210 410 340 470 390 C520 430 560 400 600 450 L600 600 L0 600 Z"
        />
      </svg>
      <div className="scene-blooms">
        {BLOOMS.map((bloom, index) => (
          <span
            key={index}
            style={{
              left: `${bloom.left}%`,
              top: `${bloom.top}%`,
              width: bloom.size,
              height: bloom.size,
              animationDelay: `${bloom.delay}s`,
              animationDuration: `${bloom.duration}s`,
            }}
          />
        ))}
      </div>

      <PaintedBackdrop />

      <div className="scene-mist">
        <span className="mist m1" />
        <span className="mist m2" />
        <span className="mist m3" />
      </div>
      <div className="scene-runes">
        {RUNES.map((rune, index) => (
          <span
            key={index}
            style={
              {
                left: `${rune.left}%`,
                fontSize: rune.size,
                animationDelay: `${rune.delay}s`,
                animationDuration: `${rune.duration}s`,
              } as CSSProperties
            }
          >
            {rune.char}
          </span>
        ))}
      </div>
    </div>
  );
}

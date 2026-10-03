'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * While the guide divines: a happyhorse clip of ink blooming and turning in
 * water, kept small and round and multiplied into the paper.
 */
export function InkThinking({ size = 112, label = '司命正在推演' }: { size?: number; label?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  // Reduced motion: hold the first bloom still instead of looping.
  useEffect(() => {
    const video = videoRef.current;
    if (video && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.removeAttribute('autoplay');
      video.pause();
    }
  }, []);

  return (
    <output className="ink-thinking" aria-label={label} style={{ width: size, height: size }}>
      {!failed && (
        <video
          ref={videoRef}
          src="/videos/thinking.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={() => setFailed(true)}
        />
      )}
    </output>
  );
}

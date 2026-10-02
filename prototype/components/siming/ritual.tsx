import { useEffect, useRef, useState } from 'react';

import { InkWriting } from './writing';

export type GuaCardData = {
  kind: 'gua';
  tosses: number[];
  changing: number[];
  present: { number: number; name: string; upper: string; lower: string };
  future: { number: number; name: string; upper: string; lower: string } | null;
};

type Toss = { coins: number[]; value: number };

/** Three coins: the plain back counts 3, the inscribed face 2 (after 火珠林). */
function throwCoins(): Toss {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  const coins = [...bytes].map((byte) => (byte < 128 ? 3 : 2));
  return { coins, value: coins.reduce((sum, coin) => sum + coin, 0) };
}

const isYang = (value: number) => value === 7 || value === 9;

/** A hexagram drawn as six brush strokes, bottom line first; changing lines are marked ○ / ×. */
export function GuaFigure({ tosses, size = 120 }: { tosses: number[]; size?: number }) {
  return (
    <svg className="gua-figure" width={size} height={size * 1.05} viewBox="0 0 120 126" aria-hidden="true">
      {tosses.map((value, index) => {
        const y = 126 - (index + 0.5) * 21;
        const yang = isYang(value);
        return (
          <g key={index} className="gua-line" style={{ animationDelay: `${index * 0.08}s` }}>
            {yang ? (
              <line x1="14" x2="106" y1={y} y2={y} />
            ) : (
              <>
                <line x1="14" x2="50" y1={y} y2={y} />
                <line x1="70" x2="106" y1={y} y2={y} />
              </>
            )}
            {value === 9 && <circle className="gua-mark" cx="116" cy={y} r="3.4" />}
            {value === 6 && (
              <g className="gua-mark">
                <line x1="112.5" x2="119.5" y1={y - 3.5} y2={y + 3.5} />
                <line x1="119.5" x2="112.5" y1={y - 3.5} y2={y + 3.5} />
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function Coin({ face, spinning, index }: { face: number | null; spinning: boolean; index: number }) {
  return (
    <div className={`coin ${spinning ? 'is-spinning' : ''}`} style={{ animationDelay: `${index * 70}ms` }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="46" className="coin-body" />
        <circle cx="50" cy="50" r="40" className="coin-rim" />
        <rect x="40" y="40" width="20" height="20" className="coin-hole" />
        {face === 2 && (
          <g className="coin-text">
            <text x="50" y="30">问</text>
            <text x="50" y="84">时</text>
            <text x="25" y="57">通</text>
            <text x="75" y="57">宝</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/**
 * The casting ritual, full screen: still the mind over a drop of ink in
 * water, throw three coins six times over a quiet pool, then watch the
 * hexagram settle as ripples spread. Nothing is said aloud.
 */
export function CastRitual({
  gua,
  onCast,
  onClose,
}: {
  gua: GuaCardData | null;
  onCast: (tosses: number[]) => void;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<'still' | 'toss' | 'reveal'>('still');
  const [ready, setReady] = useState(false);
  const [tosses, setTosses] = useState<Toss[]>([]);
  const [spinning, setSpinning] = useState(false);
  const sent = useRef(false);

  // Give the stilling a few breaths before offering to go on.
  useEffect(() => {
    if (stage !== 'still') return;
    const timer = setTimeout(() => setReady(true), 4500);
    return () => clearTimeout(timer);
  }, [stage]);

  const toss = () => {
    if (spinning || tosses.length >= 6) return;
    setSpinning(true);
    const result = throwCoins();
    setTimeout(() => {
      setSpinning(false);
      setTosses((current) => [...current, result]);
    }, 1100);
  };

  // Six lines: hand the cast over and let the hexagram settle.
  useEffect(() => {
    if (tosses.length !== 6 || sent.current) return;
    sent.current = true;
    const timer = setTimeout(() => {
      onCast(tosses.map((item) => item.value));
      setStage('reveal');
    }, 900);
    return () => clearTimeout(timer);
  }, [tosses, onCast]);

  const values = tosses.map((item) => item.value);
  const last = tosses.at(-1);

  return (
    <section className={`ritual ritual-${stage}`} aria-label="起卦">
      {stage === 'still' && (
        <video className="ritual-video" src="/videos/still.mp4" autoPlay muted playsInline onEnded={() => setReady(true)} />
      )}
      {stage === 'toss' && <video className="ritual-video" src="/videos/cast-pool.mp4" autoPlay muted loop playsInline />}
      {stage === 'reveal' && (
        <video className="ritual-video" src="/videos/reveal.mp4" autoPlay muted playsInline onEnded={() => gua && onClose()} />
      )}
      <div className="ritual-veil" />

      {stage === 'still' && (
        <div className="ritual-center">
          <InkWriting text={'闭目三息\n默念所问'} streaming={false} instant={false} />
          <button type="button" className={`ritual-seal ${ready ? 'is-ready' : ''}`} onClick={() => setStage('toss')}>
            心定
          </button>
        </div>
      )}

      {stage === 'toss' && (
        <div className="ritual-cast">
          <div className="ritual-lines" aria-live="polite">
            <GuaFigure tosses={values} size={92} />
            <p className="ritual-count">{tosses.length < 6 ? `第${'一二三四五六'[tosses.length]}爻` : '卦成'}</p>
          </div>
          <button
            type="button"
            className="ritual-coins"
            onClick={toss}
            disabled={spinning || tosses.length >= 6}
            aria-label="掷钱"
          >
            {[0, 1, 2].map((index) => (
              <Coin key={index} index={index} spinning={spinning} face={spinning ? null : (last?.coins[index] ?? null)} />
            ))}
          </button>
          <button type="button" className="ritual-seal is-ready" onClick={toss} disabled={spinning || tosses.length >= 6}>
            掷
          </button>
        </div>
      )}

      {stage === 'reveal' && (
        <div className="ritual-center ritual-reveal" role="presentation" onClick={() => gua && onClose()}>
          <GuaFigure tosses={values} size={150} />
          {gua ? (
            <p className="ritual-name">
              {gua.present.name}
              {gua.future && (
                <>
                  <small>之</small>
                  {gua.future.name}
                </>
              )}
            </p>
          ) : (
            <p className="ritual-name is-waiting">…</p>
          )}
        </div>
      )}
    </section>
  );
}

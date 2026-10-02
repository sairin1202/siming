import type { CSSProperties } from 'react';

import type { ChartCardData } from './cards';

const STEMS = '甲乙丙丁戊己庚辛壬癸';
const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
const STEM_ELEMENTS = ['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water'];
const BRANCH_ELEMENTS = ['water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water'];
const PILLAR_LABELS = ['年', '月', '日', '时'];

function Glyph({ char, element, order }: { char: string; element: string; order: number }) {
  return (
    <span className={`cast-glyph el-${element}`} style={{ '--o': order } as CSSProperties}>
      {char}
    </span>
  );
}

/**
 * Chart casting: a happyhorse star-chart clip plays behind while the four
 * pillars bloom in one by one like ink in water. Timing is pure CSS;
 * `onDone` fires when the exit fade ends, or on click.
 */
export function ChartCasting({ card, onDone }: { card: ChartCardData; onDone: () => void }) {
  return (
    <div
      className="casting"
      role="presentation"
      onClick={onDone}
      onAnimationEnd={(event) => {
        if (event.animationName === 'cast-exit') onDone();
      }}
    >
      <video
        className="cast-video"
        src="/videos/casting.mp4"
        poster="/backgrounds/casting.jpg"
        autoPlay
        muted
        playsInline
        // Slowed so the whole ritual stays in the clip's calm, early ink bloom.
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = 0.7;
        }}
      />
      <div className="cast-veil" />

      <div className="cast-core">
        <p className="cast-title">排 盘</p>
        <span className="cast-rule" />
        <div className="cast-pillars">
          {card.pillars.map((pillar, index) => (
            <div key={PILLAR_LABELS[index]} className={`cast-pillar ${index === 2 ? 'is-day' : ''}`}>
              <span className="cast-label" style={{ '--o': index * 2 } as CSSProperties}>
                {PILLAR_LABELS[index]}柱
              </span>
              {pillar ? (
                <>
                  <Glyph char={pillar[0]} element={STEM_ELEMENTS[STEMS.indexOf(pillar[0])]} order={index * 2} />
                  <Glyph char={pillar[1]} element={BRANCH_ELEMENTS[BRANCHES.indexOf(pillar[1])]} order={index * 2 + 1} />
                </>
              ) : (
                <span className="cast-glyph cast-unknown" style={{ '--o': index * 2 } as CSSProperties}>
                  未详
                </span>
              )}
            </div>
          ))}
        </div>
        <span className="cast-rule" />
        <p className="cast-result">
          日主 <strong>{card.dayMaster}</strong>
          <span>{card.strength}</span>
          <span>喜 {card.favorable.join(' · ')}</span>
        </p>
      </div>
    </div>
  );
}

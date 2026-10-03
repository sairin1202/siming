import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

type Token = { kind: 'char'; text: string } | { kind: 'pause' } | { kind: 'para' };

type StrokeData = { strokes: string[]; medians: number[][][] } | null;

const HAN = /\p{Script=Han}/u;
// Punctuation is never written: it becomes a breath (a blank cell) instead.
const PUNCTUATION = /[\s，。、；：？！,.;:?!—…·「」『』（）()《》〈〉“”‘’"'-]/u;
const DIGITS = '〇一二三四五六七八九';
const BRUSH_FONT = 'Ma Shan Zheng';

function smallNumber(value: number) {
  if (value < 10) return DIGITS[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens === 1 ? '' : DIGITS[tens]}十${ones ? DIGITS[ones] : ''}`;
}

/** Arabic numerals read better as characters in brush text: 2026年 → 二〇二六年, 58 → 五十八. */
export function toHanNumerals(text: string) {
  return text.replace(/\d+/g, (digits, offset: number, whole: string) => {
    if (digits.length > 2 || whole[offset + digits.length] === '年') {
      return digits.split('').map((digit) => DIGITS[Number(digit)]).join('');
    }
    return smallNumber(Number(digits));
  });
}

/** Characters to write, with breaths where punctuation was and paragraph breaks between columns. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  toHanNumerals(text)
    .split(/\n+/)
    .forEach((paragraph, index) => {
      if (index > 0 && tokens.length) tokens.push({ kind: 'para' });
      for (const char of paragraph) {
        if (PUNCTUATION.test(char)) {
          const last = tokens.at(-1);
          if (last && last.kind === 'char') tokens.push({ kind: 'pause' });
          continue;
        }
        tokens.push({ kind: 'char', text: char });
      }
      while (tokens.at(-1)?.kind === 'pause') tokens.pop();
    });
  return tokens;
}

// Stroke data, fetched in batches from our own /api/strokes and kept for the session.
const strokeCache = new Map<string, StrokeData>();
const pending = new Map<string, Promise<void>>();

function loadStrokes(chars: string[]) {
  const missing = [...new Set(chars)].filter((char) => HAN.test(char) && !strokeCache.has(char) && !pending.has(char));
  if (missing.length) {
    const request = fetch(`/api/strokes?chars=${encodeURIComponent(missing.join(''))}`)
      .then((response) => (response.ok ? response.json() : {}))
      .catch(() => ({}))
      .then((data: Record<string, StrokeData>) => {
        for (const char of missing) {
          strokeCache.set(char, data[char] ?? null);
          pending.delete(char);
        }
      });
    for (const char of missing) pending.set(char, request);
  }
  return Promise.all(chars.map((char) => pending.get(char) ?? Promise.resolve()));
}

type Stroke = { d: string; length: number; duration: number; delay: number };

/** Plan each stroke's brush path (from the stroke-order medians) and timing. */
function planStrokes(data: NonNullable<StrokeData>, pace: number): { strokes: Stroke[]; total: number } {
  let clock = 0;
  const strokes = data.medians.map((points) => {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    }
    length = Math.max(length, 1);
    // A brush presses, sweeps and lifts: longer strokes take longer, within limits.
    const duration = Math.min(0.22, Math.max(0.08, length / 3400)) / pace;
    const stroke = {
      d: points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' '),
      length,
      duration,
      delay: clock,
    };
    clock += duration + 0.03 / pace;
    return stroke;
  });
  return { strokes, total: clock };
}

/**
 * One character brushed in its true stroke order: the calligraphy glyph is
 * revealed by a wide brush following each stroke's centre line, then the
 * whole character settles into the paper. Without stroke data it inks in.
 */
function BrushGlyph({
  index,
  char,
  size,
  animate,
  pace,
  onDone,
}: {
  index: number;
  char: string;
  size: number;
  animate: boolean;
  pace: number;
  onDone: () => void;
}) {
  const id = useId().replace(/:/g, '');
  const [data, setData] = useState<StrokeData | undefined>(() => strokeCache.get(char));
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  useEffect(() => {
    let cancelled = false;
    if (data === undefined) {
      void loadStrokes([char]).then(() => {
        if (!cancelled) setData(strokeCache.get(char) ?? null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [char, data]);

  const plan = useMemo(() => (data ? planStrokes(data, pace) : null), [data, pace]);
  const textRef = useRef<SVGTextElement>(null);

  // Calligraphy fonts draw well outside their em box. Measure the real glyph
  // and fit it into the 1024-unit square the stroke-order data lives in, so
  // the brush lines up with the strokes and nothing falls outside the mask.
  useLayoutEffect(() => {
    const text = textRef.current;
    if (!text) return;
    const box = text.getBBox();
    if (!box.width || !box.height) return;
    const scale = Math.min(880 / box.width, 880 / box.height);
    const x = 512 - (box.x + box.width / 2) * scale;
    const y = 512 - (box.y + box.height / 2) * scale;
    text.setAttribute('transform', `translate(${x} ${y}) scale(${scale})`);
    text.style.visibility = 'visible';
  }, [data]);

  useEffect(() => {
    if (data === undefined) return;
    const wait = !animate ? 0 : plan ? (plan.total + 0.12) * 1000 : 260;
    const timer = setTimeout(() => done.current(), wait);
    return () => clearTimeout(timer);
  }, [data, plan, animate]);

  const glyph = (
    <g filter="url(#brush-ink)">
      <text ref={textRef} x="0" y="0" fontSize="1024" className="brush-text" style={{ visibility: 'hidden' }}>
        {char}
      </text>
    </g>
  );

  if (data === undefined) return <span className="brush-glyph" data-token={index} style={{ width: size, height: size }} />;

  return (
    <svg
      className="brush-glyph"
      data-token={index}
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      aria-hidden="true"
    >
      {plan && animate ? (
        <>
          <defs>
            <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="-256" y="-256" width="1536" height="1536">
              <g transform="translate(0 900) scale(1 -1)">
                {plan.strokes.map((stroke, index) => (
                  <path
                    key={index}
                    d={stroke.d}
                    className="brush-path"
                    style={{
                      strokeDasharray: stroke.length,
                      strokeDashoffset: stroke.length,
                      animationDuration: `${stroke.duration}s`,
                      animationDelay: `${stroke.delay}s`,
                    }}
                  />
                ))}
              </g>
              {/* Brush tips and flourishes beyond the centre lines settle in at the end. */}
              <rect
                x="-256"
                y="-256"
                width="1536"
                height="1536"
                className="brush-settle"
                style={{ animationDelay: `${plan.total}s` }}
              />
            </mask>
          </defs>
          <g mask={`url(#m${id})`}>{glyph}</g>
        </>
      ) : (
        <g className={animate ? 'brush-fade' : undefined}>{glyph}</g>
      )}
    </svg>
  );
}

// If a character never reports back (it shouldn't), move on after this long.
const SAFETY_MS = 5000;

/**
 * Classical text brushed onto the paper stroke by stroke, top to bottom and
 * right to left, with breaths instead of punctuation.
 */
export function InkWriting({
  text,
  streaming,
  instant,
  hold = false,
  startDelay = 0,
  onDone,
}: {
  text: string;
  streaming: boolean;
  instant: boolean;
  /** Don't lift the brush yet (the reply is still arriving, so the layout isn't final). */
  hold?: boolean;
  /** Wait this long (ms) before the first stroke, e.g. while the last verse fades. */
  startDelay?: number;
  onDone?: () => void;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const [count, setCount] = useState(instant ? Number.MAX_SAFE_INTEGER : 0);
  const [skipFrom, setSkipFrom] = useState<number | null>(null);
  const [size, setSize] = useState(30);
  const [ready, setReady] = useState(instant);
  const shown = Math.min(count, tokens.length);
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const advanced = useRef(-2); // index of the last token we moved past; -1 means "before the first"
  const chars = tokens.flatMap((token) => (token.kind === 'char' ? [token.text] : []));
  // One brush, one pace: every character waits for the one before it.
  // A long reading is written with a quicker hand, so it still finishes in about a minute.
  const pace = Math.min(6, Math.max(2, chars.length / 35));

  // Move past token `from`, revealing the one after it (count = from + 2).
  const advance = (from: number) => {
    if (advanced.current >= from) return;
    advanced.current = from;
    setCount((value) => Math.max(value, from + 2));
  };

  const finishNow = () => {
    setSkipFrom((value) => value ?? shown);
    setCount(Number.MAX_SAFE_INTEGER);
  };

  // Character size follows the CSS font size of the writing area.
  useEffect(() => {
    if (ref.current) {
      // oxlint-disable-next-line react/react-compiler
      setSize(Math.round(parseFloat(getComputedStyle(ref.current).fontSize)));
    }
  }, []);

  // Have stroke data and the brush font's glyphs in hand before the first stroke.
  useEffect(() => {
    void Promise.all([
      loadStrokes(chars),
      document.fonts.load(`40px "${BRUSH_FONT}"`, chars.join('')).catch(() => []),
    ]).then(() => setReady(true));
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    if (!ready || hold || shown >= tokens.length) return;
    const current = shown - 1;
    const token = tokens[current];
    // Characters advance themselves when their last stroke lands; this is
    // only the lead-in, the breath after a pause, or a safety net.
    const wait =
      current < 0 ? startDelay + 160 : token?.kind === 'char' ? SAFETY_MS : token?.kind === 'para' ? 420 : 260;
    const timer = setTimeout(() => advance(current), wait);
    return () => clearTimeout(timer);
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, hold, shown, tokens, startDelay]);

  useEffect(() => {
    const finished = shown >= tokens.length && !streaming && tokens.length > 0;
    if (finished && !doneRef.current) {
      doneRef.current = true;
      onDone?.();
    }
  }, [shown, tokens.length, streaming, onDone]);

  // Every character already has its place, so nothing shifts as we write.
  // If the text needs more columns than fit, bring the one being written into view.
  useEffect(() => {
    const element = ref.current;
    const current = element?.querySelector(`[data-token="${shown - 1}"]`);
    current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [shown]);

  return (
    <div
      ref={ref}
      className="ink-writing"
      role="presentation"
      // Tapping the writing finishes it at once; it also finishes on its own.
      onClick={finishNow}
      onKeyDown={finishNow}
      onWheel={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth - element.clientWidth > 24 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          element.scrollLeft -= event.deltaY;
        }
      }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {tokens.map((token, index) => {
          if (token.kind === 'para') return <span key={index} className="ink-para" />;
          if (token.kind === 'pause') return <span key={index} className="ink-pause" />;
          // Not yet written: an empty cell holding the character's place.
          if (!ready || index >= shown) {
            return <span key={index} className="brush-glyph" style={{ width: size, height: size }} />;
          }
          return (
            <BrushGlyph
              key={index}
              index={index}
              char={token.text}
              size={size}
              pace={pace}
              animate={!instant && (skipFrom === null || index < skipFrom)}
              onDone={() => setTimeout(() => advance(index), 60)}
            />
          );
        })}
      </span>
    </div>
  );
}

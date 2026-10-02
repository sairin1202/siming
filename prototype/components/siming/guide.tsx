export type GuideMood = 'idle' | 'listening' | 'divining' | 'speaking' | 'farewell';

// Trigram lines from the outer edge inward; 1 = solid (yang), 0 = broken (yin).
const TRIGRAMS = [
  [1, 1, 1],
  [0, 1, 1],
  [1, 0, 1],
  [0, 0, 1],
  [1, 1, 0],
  [0, 1, 0],
  [1, 0, 0],
  [0, 0, 0],
];

function Trigram({ lines, angle }: { lines: number[]; angle: number }) {
  return (
    <g transform={`rotate(${angle} 100 100)`}>
      {lines.map((solid, index) => {
        const y = 22 + index * 8.5;
        return solid ? (
          <line key={index} x1="85" x2="115" y1={y} y2={y} />
        ) : (
          <g key={index}>
            <line x1="85" x2="96.5" y1={y} y2={y} />
            <line x1="103.5" x2="115" y1={y} y2={y} />
          </g>
        );
      })}
    </g>
  );
}

/** An ink-brush bagua: enso circle, eight trigram strokes and a taiji. */
export function BaguaChart({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true">
      <path
        className="bagua-enso"
        d="M100 7 C152 6 194 46 193 100 C192 152 150 193 99 193 C47 192 8 152 8 100 C8 58 36 22 74 11"
      />
      <g className="bagua-lines">
        {TRIGRAMS.map((lines, index) => (
          <Trigram key={index} lines={lines} angle={index * 45} />
        ))}
      </g>
      <g className="taiji">
        <circle cx="100" cy="100" r="26" className="taiji-yang" />
        <path
          className="taiji-yin"
          d="M100 74 A26 26 0 0 1 100 126 A13 13 0 0 1 100 100 A13 13 0 0 0 100 74 Z"
        />
        <circle cx="100" cy="87" r="3.6" className="taiji-yin" />
        <circle cx="100" cy="113" r="3.6" className="taiji-yang" />
        <circle cx="100" cy="100" r="26" className="taiji-rim" />
      </g>
    </svg>
  );
}

/** 司命 as pure atmosphere: a faint ink bagua behind the dialogue. */
export function Guide({ mood }: { mood: GuideMood }) {
  return (
    <div className={`guide guide-${mood}`}>
      <BaguaChart className="guide-chart" />
      <p className="guide-name">司命</p>
    </div>
  );
}

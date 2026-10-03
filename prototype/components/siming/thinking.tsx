/** While the guide divines: one brush circle (圆相) drawn, held, and let go, again and again. */
export function InkThinking({ size = 56, label = '司命正在推演' }: { size?: number; label?: string }) {
  return (
    <output className="ink-thinking" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {/* Wash, body and dry edge, laid a beat apart so the stroke swells and thins like a brush. */}
        <path className="enso-wash" d="M34 14 A38 38 0 1 1 15 36" pathLength={100} />
        <path className="enso-body" d="M34 14 A38 38 0 1 1 15 36" pathLength={100} />
        <path className="enso-dry" d="M36 17 A35 35 0 1 1 18 37" pathLength={100} />
      </svg>
    </output>
  );
}

/**
 * While the guide divines: a vast vortex of ink mist turning slowly around a
 * still centre, with a fainter, wider veil of the same cloud turning behind it.
 */
export function InkThinking({ width = 'min(88vw, 500px)', label = '司命正在推演' }: { width?: string; label?: string }) {
  return (
    <output className="ink-thinking" aria-label={label} style={{ width }}>
      <span className="vortex-veil" aria-hidden="true" />
      <span className="vortex-core" aria-hidden="true" />
    </output>
  );
}

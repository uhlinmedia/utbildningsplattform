// Briondo-ordbild: variant A (ljus bakgrund) och E (mörk bakgrund).
export function Wordmark({ size = 24, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span
      className="wordmark"
      style={{ fontSize: size, color: dark ? '#FFFFFF' : 'var(--brand-ink)' }}
      aria-label="Briondo"
    >
      Brion<span style={{ color: dark ? 'var(--brand-accent-light)' : 'var(--brand-accent)' }}>do</span>
    </span>
  );
}

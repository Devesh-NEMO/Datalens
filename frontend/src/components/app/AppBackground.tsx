/**
 * CSS-only ambient background for the app pages (no WebGL): a navy base with a
 * soft indigo radial glow near the top and a very faint grid that fades out
 * with a mask (dark), or #F8FAFC with a pale indigo/blue glow and an even
 * fainter grid (light). Fixed behind all content, never intercepts pointer
 * events, and never reduces text contrast — it is pure background paint.
 */
export function AppBackground() {
  return (
    <div aria-hidden="true" className="app-bg fixed inset-0 z-0 pointer-events-none">
      <div className="app-bg-grid absolute inset-0" />
    </div>
  );
}
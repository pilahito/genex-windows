/**
 * Genex Windows Community (unofficial fork): a plain text wordmark instead of the official Genex
 * logo, so the fork never looks like an official Genex build. The original wordmark is in the
 * upstream repository (genex-games/genex-desktop).
 */
export function GenexLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={className}
      role="img"
      aria-label="Genex Windows Community (unofficial)"
      title="Genex Windows Community — unofficial fork of Genex"
      style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap", fontWeight: 700, letterSpacing: "0.04em" }}
    >
      <span>GENEX</span>
      <span style={{ fontSize: "0.7em", fontWeight: 600, color: "#ff4fa3" }}>WINDOWS COMMUNITY</span>
      <span style={{ fontSize: "0.6em", fontWeight: 500, opacity: 0.6 }}>unofficial</span>
    </span>
  );
}

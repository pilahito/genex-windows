/**
 * Genex Windows Community (unofficial fork): a plain text wordmark instead of the official Genex
 * logo, so the fork never looks like an official Genex build. The original wordmark is in the
 * upstream repository (genex-games/genex-desktop).
 *
 * Two lines: GENEX, and the fork's name small underneath. On one line the fork's name ran under the
 * sidebar's search and notification buttons.
 */
export function GenexLogo({ className = "" }: { className?: string }) {
  return (
    <span
      className={className}
      role="img"
      aria-label="Genex Windows Community (no oficial)"
      title="Genex Windows Community — versión no oficial de Genex"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "flex-start",
        lineHeight: 1,
        whiteSpace: "nowrap",
        fontWeight: 700,
        letterSpacing: "0.04em",
        maxWidth: "100%",
        overflow: "hidden",
      }}
    >
      <span>GENEX</span>
      <span
        style={{
          marginTop: 3,
          fontSize: "0.52em",
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "#ff4fa3",
        }}
      >
        WINDOWS COMMUNITY
      </span>
    </span>
  );
}

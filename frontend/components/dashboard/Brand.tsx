/**
 * The landing page's mark — the same drawing, not a near-miss.
 *
 * The dashboard sits one click inside the marketing page, and arriving there
 * to a different glyph would make it read as another product. Copied from
 * `components/landing/LandingPage.tsx` deliberately; if the mark is ever
 * redrawn, both should change together.
 */

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 26 26"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 20 13 6l8 14M5 20h16"
        fill="none"
        stroke="#CF9D7B"
        strokeWidth="2"
      />
      <circle cx="13" cy="6" r="3.4" fill="#CF9D7B" />
      <circle cx="5" cy="20" r="3" fill="#F1E6DA" />
      <circle
        cx="21"
        cy="20"
        r="3"
        fill="none"
        stroke="#E0674B"
        strokeWidth="2"
      />
    </svg>
  );
}

export default BrandMark;

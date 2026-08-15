import React from "react";

/**
 * The lamplight backdrop behind the login and welcome screens.
 *
 * Three pools of light, all positioned and animated in CSS (see the
 * LAMPLIGHT section of globals.src.css). This used to run three
 * framer-motion loops rotating and translating the blobs by up to 20%
 * every 12–18s; that was a lava lamp behind a login form, and it kept
 * three JS-driven animations alive for the lifetime of the page.
 *
 * Being plain CSS also means it is a server component and it picks up
 * the global `prefers-reduced-motion` rule for free.
 */
export default function SpotlightBackground({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="spotlight-container">
      <div className="spotlight-overlay" aria-hidden="true">
        <div className="spotlight spotlight-mid" />
        <div className="spotlight spotlight-left" />
        <div className="spotlight spotlight-right" />
      </div>

      <div className="spotlight-content">{children}</div>
    </div>
  );
}

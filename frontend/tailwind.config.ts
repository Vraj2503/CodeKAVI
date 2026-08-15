import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", "class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./hooks/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "ui-monospace", "monospace"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Telemetry semantics. A code-intelligence tool constantly reports
        // states — complexity bands, stream health, quota — and naming them
        // stops each surface from inventing its own green.
        signal: {
          DEFAULT: "hsl(var(--signal))",
          foreground: "hsl(var(--signal-foreground))",
        },
        ok: "hsl(var(--ok))",
        warn: "hsl(var(--warn))",
        crit: "hsl(var(--crit))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 1px)",
        sm: "calc(var(--radius) - 1px)",
      },
      /*
       * Depth comes from luminance and hairlines, not drop shadows — this
       * is an instrument face, not stacked paper. `float` exists only for
       * things that genuinely leave the plane (command palette, modals),
       * and carries a signal-tinted rim rather than a soft blur.
       */
      boxShadow: {
        raise: "inset 0 1px 0 0 hsl(var(--foreground) / 0.04)",
        lift: "0 0 0 1px hsl(var(--border)), 0 8px 24px -8px hsl(var(--shadow-hue) / 0.5)",
        float:
          "0 0 0 1px hsl(var(--border)), 0 24px 64px -12px hsl(var(--shadow-hue) / 0.7)",
        glow: "0 0 0 1px hsl(var(--signal) / 0.5), 0 0 24px -4px hsl(var(--signal) / 0.35)",
      },
      /*
       * Three curves, and never `ease-in` on a UI element — it delays the
       * first frame, which is exactly the moment the user is watching, so
       * it reads as sluggish at any duration.
       */
      transitionTimingFunction: {
        // Entrances/exits. Strong ease-out — moves immediately, settles long.
        out: "cubic-bezier(0.23, 1, 0.32, 1)",
        // On-screen movement and morphs.
        "in-out": "cubic-bezier(0.77, 0, 0.175, 1)",
        // The iOS drawer curve. Panels, sheets, anything with weight.
        swift: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
    },
  },
  plugins: [
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@tailwindcss/typography")
  ],
};

export default config;

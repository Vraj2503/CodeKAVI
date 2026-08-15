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
        // These were both Geist Mono, which set every word of body copy in
        // the app in monospace. Three faces, three jobs — see layout.tsx.
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "ui-serif", "Georgia", "serif"],
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
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      /*
       * Three elevations instead of the blanket `shadow-2xl` that was on
       * every panel. A shadow that appears on everything reads as no
       * hierarchy at all; these are tuned warm so they sit in the palette
       * rather than greying it out.
       */
      boxShadow: {
        raise: "0 1px 2px hsl(var(--shadow-hue) / 0.06), 0 1px 1px hsl(var(--shadow-hue) / 0.04)",
        lift: "0 2px 4px hsl(var(--shadow-hue) / 0.06), 0 8px 16px -4px hsl(var(--shadow-hue) / 0.08)",
        float:
          "0 4px 8px hsl(var(--shadow-hue) / 0.08), 0 24px 48px -12px hsl(var(--shadow-hue) / 0.18)",
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
